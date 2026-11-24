import React, { useMemo, useState } from 'react';
import {
  Activity,
  Network,
  Plus,
  RefreshCw,
  Router as RouterIcon,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  Organization,
  PublicUser,
  RadiusSession,
  RouterDevice,
  Site,
} from '../../../packages/shared/types';
import { apiRequest } from '../../services/api';
import { StatusText } from '../ui/StatusText';

interface RouterTopologyMapProps {
  user: PublicUser;
  token: string;
  routers: RouterDevice[];
  sites: Site[];
  organizations: Organization[];
  sessions: RadiusSession[];
  refresh: () => Promise<void>;
  notify: (msg: string) => void;
  onAddRouter?: () => void;
}

interface TenantGroupSummary {
  organizationId: string;
  organizationName: string;
  siteCount: number;
  routerCount: number;
  onlineCount: number;
  mikrotikCount: number;
  omadaCount: number;
  activeSubscribers: number;
  avgLatencyMs: number | null;
}

function getStatusStroke(status: RouterDevice['status']): string {
  if (status === 'Online') return '#16A34A';
  if (status === 'Degraded') return '#D97706';
  return '#DC2626';
}

function getStatusFill(status: RouterDevice['status']): string {
  if (status === 'Online') return '#ECFDF5';
  if (status === 'Degraded') return '#FFFBEB';
  return '#FEF2F2';
}

export function RouterTopologyMap({
  user,
  token,
  routers,
  sites,
  organizations,
  sessions,
  refresh,
  notify,
  onAddRouter,
}: RouterTopologyMapProps) {
  const [vendorFilter, setVendorFilter] = useState<'All' | 'MikroTik' | 'Omada'>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Online' | 'Degraded' | 'Offline'>('All');
  const [orgFilter, setOrgFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedRouterId, setSelectedRouterId] = useState<string>('');
  const [zoom, setZoom] = useState<number>(1);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const canSync = user.role === 'super-admin' || user.role === 'admin' || user.role === 'support';

  const orgNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations) {
      map.set(org.id, org.name);
    }
    if (user.organizationId && user.organizationName && !map.has(user.organizationId)) {
      map.set(user.organizationId, user.organizationName);
    }
    return map;
  }, [organizations, user.organizationId, user.organizationName]);

  const siteLookup = useMemo(() => {
    const map = new Map<string, Site>();
    for (const s of sites) map.set(s.id, s);
    return map;
  }, [sites]);

  const activeSessionCountByRouter = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (s.status === 'Active') {
        map.set(s.routerId, (map.get(s.routerId) || 0) + 1);
      }
    }
    return map;
  }, [sessions]);

  const activeSessionCountBySite = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (s.status === 'Active') {
        map.set(s.siteId, (map.get(s.siteId) || 0) + 1);
      }
    }
    return map;
  }, [sessions]);

  const enrichedRouters = useMemo(() => {
    return routers.map((r) => {
      const liveCount = activeSessionCountByRouter.get(r.id) ?? r.activeLeases ?? 0;
      return {
        ...r,
        resolvedOrgName: r.organizationName || orgNameLookup.get(r.organizationId) || user.organizationName,
        resolvedLeases: Math.max(liveCount, r.activeLeases || 0),
        siteObj: siteLookup.get(r.siteId),
      };
    });
  }, [activeSessionCountByRouter, orgNameLookup, routers, siteLookup, user.organizationName]);

  const tenantOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of enrichedRouters) {
      if (!seen.has(r.organizationId)) {
        seen.set(r.organizationId, r.resolvedOrgName);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [enrichedRouters]);

  const filteredRouters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedRouters.filter((r) => {
      if (vendorFilter !== 'All' && r.vendor !== vendorFilter) return false;
      if (statusFilter !== 'All' && r.status !== statusFilter) return false;
      if (orgFilter !== 'all' && r.organizationId !== orgFilter) return false;
      if (q) {
        return (
          r.name.toLowerCase().includes(q) ||
          r.ipAddress.toLowerCase().includes(q) ||
          r.wireguardTunnelIp.toLowerCase().includes(q) ||
          r.siteName.toLowerCase().includes(q) ||
          r.resolvedOrgName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [enrichedRouters, orgFilter, search, statusFilter, vendorFilter]);

  const selectedRouter =
    filteredRouters.find((r) => r.id === selectedRouterId) || filteredRouters[0] || null;

  // Group filtered devices by Site/Tenant for the hierarchical SVG diagram
  const siteClusters = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        siteId: string;
        siteName: string;
        ssid: string;
        organizationId: string;
        organizationName: string;
        activeTenantUsers: number;
        devices: typeof filteredRouters;
      }
    >();

    for (const r of filteredRouters) {
      const key = `${r.organizationId}:${r.siteId}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.devices.push(r);
      } else {
        const siteSessions = activeSessionCountBySite.get(r.siteId) ?? 0;
        grouped.set(key, {
          key,
          siteId: r.siteId,
          siteName: r.siteName,
          ssid: r.siteObj?.ssid || 'Hotspot',
          organizationId: r.organizationId,
          organizationName: r.resolvedOrgName,
          activeTenantUsers: Math.max(siteSessions, r.siteObj?.activeUsers || 0),
          devices: [r],
        });
      }
    }

    return Array.from(grouped.values()).map((cluster) => {
      const deviceLeases = cluster.devices.reduce((acc, d) => acc + d.resolvedLeases, 0);
      return {
        ...cluster,
        activeTenantUsers: Math.max(cluster.activeTenantUsers, deviceLeases),
      };
    });
  }, [activeSessionCountBySite, filteredRouters]);

  // Tenant summary breakdown table
  const tenantSummaries = useMemo<TenantGroupSummary[]>(() => {
    const map = new Map<string, TenantGroupSummary & { siteSet: Set<string>; latencies: number[] }>();
    for (const r of filteredRouters) {
      let item = map.get(r.organizationId);
      if (!item) {
        item = {
          organizationId: r.organizationId,
          organizationName: r.resolvedOrgName,
          siteCount: 0,
          routerCount: 0,
          onlineCount: 0,
          mikrotikCount: 0,
          omadaCount: 0,
          activeSubscribers: 0,
          avgLatencyMs: null,
          siteSet: new Set(),
          latencies: [],
        };
        map.set(r.organizationId, item);
      }
      item.siteSet.add(r.siteId);
      item.routerCount += 1;
      if (r.status === 'Online') item.onlineCount += 1;
      if (r.vendor === 'MikroTik') item.mikrotikCount += 1;
      else item.omadaCount += 1;
      item.activeSubscribers += r.resolvedLeases;
      if (typeof r.latencyMs === 'number') {
        item.latencies.push(r.latencyMs);
      }
    }

    return Array.from(map.values()).map((entry) => ({
      organizationId: entry.organizationId,
      organizationName: entry.organizationName,
      siteCount: entry.siteSet.size,
      routerCount: entry.routerCount,
      onlineCount: entry.onlineCount,
      mikrotikCount: entry.mikrotikCount,
      omadaCount: entry.omadaCount,
      activeSubscribers: entry.activeSubscribers,
      avgLatencyMs:
        entry.latencies.length > 0
          ? Math.round(entry.latencies.reduce((a, b) => a + b, 0) / entry.latencies.length)
          : null,
    }));
  }, [filteredRouters]);

  // Overall KPI calculations
  const onlineCount = filteredRouters.filter((r) => r.status === 'Online').length;
  const degradedCount = filteredRouters.filter((r) => r.status === 'Degraded').length;
  const offlineCount = filteredRouters.filter((r) => r.status === 'Offline').length;
  const measuredLatencies = filteredRouters
    .map((r) => r.latencyMs)
    .filter((v): v is number => typeof v === 'number');
  const avgLatencyMs =
    measuredLatencies.length > 0
      ? Math.round(measuredLatencies.reduce((a, b) => a + b, 0) / measuredLatencies.length)
      : null;
  const totalActiveLeases = filteredRouters.reduce((sum, r) => sum + r.resolvedLeases, 0);

  // SVG Layout Geometry
  const deviceCardW = 196;
  const deviceCardH = 92;
  const deviceGap = 20;
  const clusterPad = 24;
  const siteNodeW = 216;
  const siteNodeH = 56;
  const hubW = 260;
  const hubH = 58;

  const layout = useMemo(() => {
    const clusterWidths = siteClusters.map((c) =>
      Math.max(siteNodeW, c.devices.length * deviceCardW + Math.max(0, c.devices.length - 1) * deviceGap)
    );
    const totalContentW =
      clusterWidths.reduce((a, b) => a + b, 0) + Math.max(0, siteClusters.length - 1) * clusterPad;
    const svgW = Math.max(820, totalContentW + 80);
    const svgH = 440;
    const hubX = svgW / 2;
    const hubY = 28;
    const siteY = 148;
    const deviceY = 286;

    let cursorX = (svgW - totalContentW) / 2;
    const nodes = siteClusters.map((cluster, idx) => {
      const width = clusterWidths[idx];
      const centerX = cursorX + width / 2;
      const devicesWidth =
        cluster.devices.length * deviceCardW + Math.max(0, cluster.devices.length - 1) * deviceGap;
      let devX = centerX - devicesWidth / 2;

      const positionedDevices = cluster.devices.map((dev) => {
        const node = {
          device: dev,
          x: devX,
          y: deviceY,
          cx: devX + deviceCardW / 2,
          cy: deviceY,
        };
        devX += deviceCardW + deviceGap;
        return node;
      });

      cursorX += width + clusterPad;
      return {
        cluster,
        cx: centerX,
        x: centerX - siteNodeW / 2,
        y: siteY,
        devices: positionedDevices,
      };
    });

    return { svgW, svgH, hubX, hubY, nodes };
  }, [siteClusters]);

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      await apiRequest('/api/routers/sync-all', { method: 'POST', token });
      await refresh();
      notify('Probed connected MikroTik and Omada hardware telemetry.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to probe routers.');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSyncOne = async (id: string) => {
    setSyncingId(id);
    try {
      await apiRequest(`/api/routers/${id}/sync`, { method: 'POST', token });
      await refresh();
      notify('Router hardware telemetry synced.');
    } finally {
      setSyncingId(null);
    }
  };

  const selectedSessions = selectedRouter
    ? sessions.filter((s) => s.routerId === selectedRouter.id && s.status === 'Active')
    : [];

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-blue-700" />
              <h2 className="font-display text-base font-bold text-slate-900">
                MikroTik &amp; Omada Device Topology Map
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Visualizes WireGuard hub routing, tenant hotspot sites, hardware status, measured round-trip latency, and active subscriber counts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {canSync && routers.length > 0 && (
              <button
                type="button"
                disabled={syncingAll}
                onClick={handleSyncAll}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`} />
                <span>{syncingAll ? 'Probing Devices...' : 'Probe All Devices'}</span>
              </button>
            )}
            {onAddRouter && (
              <button
                type="button"
                onClick={onAddRouter}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Router</span>
              </button>
            )}
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-md divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Mapped Hardware</div>
            <div className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {filteredRouters.length}
              <span className="text-xs font-normal text-slate-500 ml-2">
                {filteredRouters.filter((r) => r.vendor === 'MikroTik').length} MikroTik ·{' '}
                {filteredRouters.filter((r) => r.vendor === 'Omada').length} Omada
              </span>
            </div>
          </div>
          <div className="p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Device Health</div>
            <div className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {onlineCount} Online
              <span className="text-xs font-normal text-slate-500 ml-2">
                {degradedCount} Deg · {offlineCount} Off
              </span>
            </div>
          </div>
          <div className="p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Avg Measured Latency</div>
            <div className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {avgLatencyMs !== null ? `${avgLatencyMs} ms` : '—'}
              <span className="text-xs font-normal text-slate-500 ml-2">
                {measuredLatencies.length}/{filteredRouters.length} probed
              </span>
            </div>
          </div>
          <div className="p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Active Tenants &amp; Users</div>
            <div className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {tenantSummaries.length} Tenant{tenantSummaries.length === 1 ? '' : 's'}
              <span className="text-xs font-normal text-slate-500 ml-2">
                {totalActiveLeases} active users
              </span>
            </div>
          </div>
        </div>

        {/* Interactive Filters Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['All', 'MikroTik', 'Omada'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVendorFilter(v)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    vendorFilter === v ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {v === 'All' ? 'All Vendors' : v}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['All', 'Online', 'Degraded', 'Offline'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {tenantOptions.length > 1 && (
              <select
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                aria-label="Filter by tenant organization"
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="all">All Tenants ({tenantOptions.length})</option>
                {tenantOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search host, IP, site, or tenant..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
            />
          </div>
        </div>
      </div>

      {routers.length === 0 ? (
        <div className="border border-slate-200 bg-white rounded-lg p-10 text-center space-y-3">
          <RouterIcon className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="font-display text-base font-bold text-slate-900">
            No MikroTik or Omada Devices Onboarded Yet
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Add a hotspot site and complete the Add Router Wizard to map live WireGuard tunnels, bridge subnets, device latencies, and active tenant counts here.
          </p>
          {onAddRouter && (
            <button
              type="button"
              onClick={onAddRouter}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Launch Add Router Wizard</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Interactive SVG Network Topology Canvas */}
          <div className="lg:col-span-8 border border-slate-200 bg-white rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600 flex flex-wrap items-center gap-3">
                <span className="font-semibold text-slate-900">Topology Canvas</span>
                <span aria-hidden="true">·</span>
                <span>Click any MikroTik or Omada node to inspect live telemetry</span>
              </div>
              <div className="inline-flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
                  className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded cursor-pointer"
                  aria-label="Zoom out topology"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  className="px-2 py-1 text-[11px] font-mono text-slate-600 hover:text-slate-900 border border-slate-200 rounded cursor-pointer tabular-nums"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.15).toFixed(2))))}
                  className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded cursor-pointer"
                  aria-label="Zoom in topology"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {filteredRouters.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                No routers match the current vendor, status, or tenant filter.
              </div>
            ) : (
              <div className="bg-[#F8FAFC] overflow-x-auto p-4">
                <svg
                  width={Math.round(layout.svgW * zoom)}
                  height={Math.round(layout.svgH * zoom)}
                  viewBox={`0 0 ${layout.svgW} ${layout.svgH}`}
                  className="mx-auto block select-none"
                  role="img"
                  aria-label="Interactive network topology map of MikroTik and Omada routers"
                >
                  <defs>
                    <pattern id="xcloud-topo-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                      <circle cx="1.5" cy="1.5" r="1" fill="#CBD5E1" opacity="0.6" />
                    </pattern>
                  </defs>
                  <rect width={layout.svgW} height={layout.svgH} fill="url(#xcloud-topo-grid)" rx="8" />

                  {/* Edges: Core Hub -> Site/Tenant Cluster */}
                  {layout.nodes.map(({ cluster, cx, y }) => {
                    const hasOnline = cluster.devices.some((d) => d.status === 'Online');
                    const strokeColor = hasOnline ? '#1D4ED8' : '#94A3B8';
                    const startY = layout.hubY + hubH;
                    const midY = (startY + y) / 2;
                    return (
                      <path
                        key={`edge-hub-${cluster.key}`}
                        d={`M ${layout.hubX} ${startY} C ${layout.hubX} ${midY}, ${cx} ${midY}, ${cx} ${y}`}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={2}
                        strokeDasharray={hasOnline ? undefined : '5 4'}
                      />
                    );
                  })}

                  {/* Edges: Site Cluster -> Router Device */}
                  {layout.nodes.map(({ cx, y, devices }) => {
                    const startY = y + siteNodeH;
                    return devices.map(({ device, cx: devCx, cy: devTopY }) => {
                      const midY = (startY + devTopY) / 2;
                      const strokeColor = getStatusStroke(device.status);
                      const latencyLabel =
                        typeof device.latencyMs === 'number' ? `${device.latencyMs} ms` : 'Unprobed';
                      return (
                        <g key={`edge-dev-${device.id}`}>
                          <path
                            d={`M ${cx} ${startY} C ${cx} ${midY}, ${devCx} ${midY}, ${devCx} ${devTopY}`}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={2}
                            strokeDasharray={device.status === 'Online' ? undefined : '5 4'}
                          />
                          <rect
                            x={(cx + devCx) / 2 - 30}
                            y={midY - 9}
                            width={60}
                            height={18}
                            rx={4}
                            fill="#FFFFFF"
                            stroke="#E2E8F0"
                          />
                          <text
                            x={(cx + devCx) / 2}
                            y={midY + 3.5}
                            textAnchor="middle"
                            fontSize={10}
                            fontFamily="JetBrains Mono, monospace"
                            fill="#334155"
                          >
                            {latencyLabel}
                          </text>
                        </g>
                      );
                    });
                  })}

                  {/* Tier 1: XCLOUD.NET Core Hub */}
                  <g transform={`translate(${layout.hubX - hubW / 2}, ${layout.hubY})`}>
                    <rect
                      width={hubW}
                      height={hubH}
                      rx={8}
                      fill="#0F172A"
                      stroke="#1E293B"
                      strokeWidth={1.5}
                    />
                    <text
                      x={hubW / 2}
                      y={23}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={700}
                      fontFamily="Outfit, sans-serif"
                      fill="#FFFFFF"
                    >
                      XCLOUD.NET WireGuard &amp; FreeRADIUS Hub
                    </text>
                    <text
                      x={hubW / 2}
                      y={42}
                      textAnchor="middle"
                      fontSize={10.5}
                      fontFamily="JetBrains Mono, monospace"
                      fill="#93C5FD"
                    >
                      10.66.0.1 · {tenantSummaries.length} Tenant(s) · {totalActiveLeases} Active
                    </text>
                  </g>

                  {/* Tier 2: Tenant & Site Cluster Nodes */}
                  {layout.nodes.map(({ cluster, x, y }) => (
                    <g key={`cluster-${cluster.key}`} transform={`translate(${x}, ${y})`}>
                      <rect
                        width={siteNodeW}
                        height={siteNodeH}
                        rx={8}
                        fill="#FFFFFF"
                        stroke="#CBD5E1"
                        strokeWidth={1.25}
                      />
                      <text
                        x={12}
                        y={20}
                        fontSize={11.5}
                        fontWeight={700}
                        fontFamily="Plus Jakarta Sans, sans-serif"
                        fill="#0F172A"
                      >
                        {cluster.siteName.slice(0, 24)}
                      </text>
                      <text
                        x={12}
                        y={36}
                        fontSize={10}
                        fontFamily="Plus Jakarta Sans, sans-serif"
                        fill="#64748B"
                      >
                        {cluster.organizationName.slice(0, 26)}
                      </text>
                      <text
                        x={siteNodeW - 12}
                        y={48}
                        textAnchor="end"
                        fontSize={10}
                        fontFamily="JetBrains Mono, monospace"
                        fill="#1D4ED8"
                      >
                        {cluster.ssid} · {cluster.activeTenantUsers} users
                      </text>
                    </g>
                  ))}

                  {/* Tier 3: MikroTik & Omada Device Nodes */}
                  {layout.nodes.flatMap(({ devices }) =>
                    devices.map(({ device, x, y }) => {
                      const isSelected = selectedRouter?.id === device.id;
                      const stroke = isSelected ? '#1D4ED8' : '#CBD5E1';
                      const statusStroke = getStatusStroke(device.status);
                      const statusFill = getStatusFill(device.status);
                      return (
                        <g
                          key={device.id}
                          transform={`translate(${x}, ${y})`}
                          onClick={() => setSelectedRouterId(device.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedRouterId(device.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                          aria-label={`${device.name} (${device.vendor}), status ${device.status}, latency ${
                            typeof device.latencyMs === 'number' ? `${device.latencyMs} ms` : 'unprobed'
                          }, ${device.resolvedLeases} active users`}
                        >
                          <rect
                            width={deviceCardW}
                            height={deviceCardH}
                            rx={8}
                            fill="#FFFFFF"
                            stroke={stroke}
                            strokeWidth={isSelected ? 2 : 1.25}
                          />
                          {/* Vendor + Status Row */}
                          <text
                            x={12}
                            y={20}
                            fontSize={10}
                            fontWeight={600}
                            fontFamily="JetBrains Mono, monospace"
                            fill={device.vendor === 'MikroTik' ? '#1D4ED8' : '#0F766E'}
                          >
                            {device.vendor.toUpperCase()}
                          </text>
                          <rect
                            x={deviceCardW - 72}
                            y={8}
                            width={60}
                            height={18}
                            rx={4}
                            fill={statusFill}
                            stroke={statusStroke}
                            strokeWidth={0.8}
                          />
                          <text
                            x={deviceCardW - 42}
                            y={20}
                            textAnchor="middle"
                            fontSize={9.5}
                            fontWeight={600}
                            fontFamily="Plus Jakarta Sans, sans-serif"
                            fill={statusStroke}
                          >
                            {device.status}
                          </text>

                          {/* Hostname & Model */}
                          <text
                            x={12}
                            y={39}
                            fontSize={12}
                            fontWeight={700}
                            fontFamily="JetBrains Mono, monospace"
                            fill="#0F172A"
                          >
                            {device.name.slice(0, 20)}
                          </text>
                          <text
                            x={12}
                            y={55}
                            fontSize={10}
                            fontFamily="JetBrains Mono, monospace"
                            fill="#64748B"
                          >
                            {device.wireguardTunnelIp} · {device.ipAddress.slice(0, 15)}
                          </text>

                          {/* Latency + Active Tenant Users Footer */}
                          <line x1={12} y1={64} x2={deviceCardW - 12} y2={64} stroke="#F1F5F9" />
                          <text
                            x={12}
                            y={80}
                            fontSize={10}
                            fontFamily="JetBrains Mono, monospace"
                            fill="#334155"
                          >
                            {typeof device.latencyMs === 'number' ? `${device.latencyMs} ms` : '— ms'}
                          </text>
                          <text
                            x={deviceCardW - 12}
                            y={80}
                            textAnchor="end"
                            fontSize={10}
                            fontWeight={600}
                            fontFamily="JetBrains Mono, monospace"
                            fill="#0F172A"
                          >
                            {device.resolvedLeases} active
                          </text>
                        </g>
                      );
                    })
                  )}
                </svg>
              </div>
            )}
          </div>

          {/* Right Device Telemetry Inspector */}
          <div className="lg:col-span-4 border border-slate-200 bg-white rounded-lg p-5 space-y-4">
            {selectedRouter ? (
              <>
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="font-mono text-xs text-slate-500">
                      {selectedRouter.vendor} · {selectedRouter.model}
                    </div>
                    <h3 className="font-mono text-base font-bold text-slate-900 mt-0.5">
                      {selectedRouter.name}
                    </h3>
                  </div>
                  <StatusText status={selectedRouter.status} />
                </div>

                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-slate-500">Tenant Organization</dt>
                    <dd className="font-semibold text-slate-900 mt-0.5 truncate">
                      {selectedRouter.resolvedOrgName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Hotspot Site</dt>
                    <dd className="font-semibold text-slate-900 mt-0.5 truncate">
                      {selectedRouter.siteName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">WAN / API Port</dt>
                    <dd className="font-mono text-slate-900 mt-0.5">
                      {selectedRouter.ipAddress}:{selectedRouter.apiPort}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">WireGuard Tunnel</dt>
                    <dd className="font-mono text-slate-900 mt-0.5">
                      {selectedRouter.wireguardTunnelIp}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Bridge · Subnet</dt>
                    <dd className="font-mono text-slate-900 mt-0.5 truncate">
                      {selectedRouter.bridgeName || 'bridge-hotspot'} ·{' '}
                      {selectedRouter.hotspotSubnet || '10.5.50.0/24'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Measured Latency</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                      {typeof selectedRouter.latencyMs === 'number'
                        ? `${selectedRouter.latencyMs} ms`
                        : 'Not probed'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">CPU / Memory</dt>
                    <dd className="font-mono text-slate-900 tabular-nums mt-0.5">
                      {selectedRouter.cpuPercent}% / {selectedRouter.memoryPercent}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Active Leases</dt>
                    <dd className="font-mono font-bold text-blue-700 tabular-nums mt-0.5">
                      {selectedRouter.resolvedLeases} subscriber(s)
                    </dd>
                  </div>
                </dl>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Uptime: {selectedRouter.uptime}</span>
                  {canSync && (
                    <button
                      type="button"
                      disabled={syncingId === selectedRouter.id}
                      onClick={() => handleSyncOne(selectedRouter.id)}
                      className="inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          syncingId === selectedRouter.id ? 'animate-spin' : ''
                        }`}
                      />
                      <span>Sync Telemetry</span>
                    </button>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                      <Activity className="w-3.5 h-3.5 text-blue-700" />
                      <span>Active Sessions on Device</span>
                    </span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {selectedSessions.length}
                    </span>
                  </div>
                  {selectedSessions.length > 0 ? (
                    <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                      {selectedSessions.slice(0, 6).map((s) => (
                        <div
                          key={s.id}
                          className="py-1.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-semibold text-slate-900 truncate">
                              {s.voucherCode}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 truncate">
                              {s.framedIp} · {s.macAddress}
                            </div>
                          </div>
                          <span className="font-mono text-[11px] text-slate-600 tabular-nums shrink-0">
                            {s.remainingMinutes}m left
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      No active RADIUS subscriber sessions currently routed through {selectedRouter.name}.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">
                Select a device on the topology canvas to inspect status, latency, and active subscriber sessions.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tenant Breakdown Table */}
      {tenantSummaries.length > 0 && (
        <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Active Tenant &amp; Hardware Distribution
              </h3>
              <p className="text-xs text-slate-500">
                Aggregated MikroTik/Omada counts, average latency, and active WiFi subscriber counts per tenant
              </p>
            </div>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Tenant Organization</th>
                <th className="py-2.5 px-4 text-right">Sites</th>
                <th className="py-2.5 px-4 text-right">MikroTik</th>
                <th className="py-2.5 px-4 text-right">Omada</th>
                <th className="py-2.5 px-4 text-right">Online / Total</th>
                <th className="py-2.5 px-4 text-right">Avg Latency</th>
                <th className="py-2.5 px-4 text-right">Active Users</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenantSummaries.map((row) => (
                <tr key={row.organizationId} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 text-xs font-semibold text-slate-900">
                    {row.organizationName}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                    {row.siteCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                    {row.mikrotikCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                    {row.omadaCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                    {row.onlineCount} / {row.routerCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                    {row.avgLatencyMs !== null ? `${row.avgLatencyMs} ms` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-blue-700 tabular-nums">
                    {row.activeSubscribers}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
