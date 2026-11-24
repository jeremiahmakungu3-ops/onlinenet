import { useMemo, useState } from 'react';
import { Pause, Play, PowerOff, RefreshCw, Search } from 'lucide-react';
import type { Organization, PublicUser, RadiusSession, RouterDevice, Site } from '../../../packages/shared/types';
import { useSessionPolling } from '../../hooks/useSessionPolling';
import { StatusText } from '../ui/StatusText';

interface LiveSessionMonitorTableProps {
  user: PublicUser;
  token: string;
  initialSessions: RadiusSession[];
  sites: Site[];
  routers: RouterDevice[];
  organizations?: Organization[];
  onAfterDisconnect?: () => Promise<void>;
  notify: (msg: string) => void;
  compact?: boolean;
}

interface RouterSiteMetrics {
  siteId: string;
  organizationId: string;
  siteName: string;
  routerName: string;
  activeUsers: number;
  totalSessions: number;
  downloadMb: number;
  uploadMb: number;
  totalMb: number;
}

interface TenantSessionMetrics {
  organizationId: string;
  organizationName: string;
  plan?: string;
  status?: string;
  activeSessions: number;
  totalSessions: number;
  activeSitesCount: number;
  activeDownloadMb: number;
  activeUploadMb: number;
  activeTotalMb: number;
  totalActiveDurationSec: number;
  avgActiveDurationSec: number;
  longestActiveDurationSec: number;
}

function formatDataMb(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function formatDurationSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getSessionDurationSeconds(session: RadiusSession, nowMs: number): number {
  const startedMs = new Date(session.startedAt).getTime();
  if (Number.isNaN(startedMs)) return 0;
  if (session.status === 'Disconnected') {
    if (session.endedAt) {
      const endedMs = new Date(session.endedAt).getTime();
      if (!Number.isNaN(endedMs)) {
        return Math.max(0, Math.floor((endedMs - startedMs) / 1000));
      }
    }
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000));
}

function formatElapsedTime(session: RadiusSession, nowMs: number): string {
  if (session.status === 'Disconnected' && !session.endedAt) {
    return 'Ended';
  }
  return formatDurationSeconds(getSessionDurationSeconds(session, nowMs));
}

export function LiveSessionMonitorTable({
  user,
  token,
  initialSessions,
  sites,
  routers,
  organizations = [],
  onAfterDisconnect,
  notify,
  compact = false,
}: LiveSessionMonitorTableProps) {
  const {
    sessions,
    isPolling,
    isPaused,
    pollIntervalMs,
    lastUpdatedAt,
    error,
    nowMs,
    togglePause,
    setPollIntervalMs,
    refreshNow,
    disconnectSession,
  } = useSessionPolling({
    token,
    initialSessions,
    intervalMs: 5000,
    enabled: true,
  });

  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'All' | 'Disconnected'>('Active');
  const [searchQuery, setSearchQuery] = useState('');
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const canDisconnect = ['super-admin', 'admin', 'support', 'customer'].includes(user.role);
  const showTenantBreakdown = user.role !== 'customer';

  const orgLookup = useMemo(() => {
    const map = new Map<string, Organization>();
    for (const org of organizations) {
      map.set(org.id, org);
    }
    return map;
  }, [organizations]);

  const resolveOrgName = useMemo(() => {
    return (session: RadiusSession): string => {
      if (session.organizationName) return session.organizationName;
      const org = orgLookup.get(session.organizationId);
      if (org?.name) return org.name;
      if (session.organizationId === user.organizationId) return user.organizationName;
      return session.organizationId;
    };
  }, [orgLookup, user.organizationId, user.organizationName]);

  const tenantMetrics = useMemo<TenantSessionMetrics[]>(() => {
    const map = new Map<
      string,
      TenantSessionMetrics & { activeSiteIds: Set<string> }
    >();

    const ensureEntry = (orgId: string, fallbackName?: string) => {
      const existing = map.get(orgId);
      if (existing) return existing;
      const org = orgLookup.get(orgId);
      const entry = {
        organizationId: orgId,
        organizationName:
          fallbackName ||
          org?.name ||
          (orgId === user.organizationId ? user.organizationName : orgId),
        plan: org?.plan,
        status: org?.status,
        activeSessions: 0,
        totalSessions: 0,
        activeSitesCount: 0,
        activeDownloadMb: 0,
        activeUploadMb: 0,
        activeTotalMb: 0,
        totalActiveDurationSec: 0,
        avgActiveDurationSec: 0,
        longestActiveDurationSec: 0,
        activeSiteIds: new Set<string>(),
      };
      map.set(orgId, entry);
      return entry;
    };

    for (const org of organizations) {
      ensureEntry(org.id, org.name);
    }

    if (user.role === 'admin' && user.organizationId) {
      ensureEntry(user.organizationId, user.organizationName);
    }

    for (const site of sites) {
      ensureEntry(site.organizationId);
    }

    for (const session of sessions) {
      const entry = ensureEntry(session.organizationId, session.organizationName);
      entry.totalSessions += 1;
      if (session.status === 'Active') {
        entry.activeSessions += 1;
        entry.activeSiteIds.add(session.siteId);
        entry.activeDownloadMb += session.downloadMb;
        entry.activeUploadMb += session.uploadMb;
        entry.activeTotalMb = entry.activeDownloadMb + entry.activeUploadMb;
        const durSec = getSessionDurationSeconds(session, nowMs);
        entry.totalActiveDurationSec += durSec;
        if (durSec > entry.longestActiveDurationSec) {
          entry.longestActiveDurationSec = durSec;
        }
      }
    }

    return Array.from(map.values())
      .map(({ activeSiteIds, ...rest }) => ({
        ...rest,
        activeSitesCount: activeSiteIds.size,
        avgActiveDurationSec:
          rest.activeSessions > 0
            ? Math.round(rest.totalActiveDurationSec / rest.activeSessions)
            : 0,
      }))
      .sort((a, b) => {
        if (b.activeSessions !== a.activeSessions) return b.activeSessions - a.activeSessions;
        if (b.activeTotalMb !== a.activeTotalMb) return b.activeTotalMb - a.activeTotalMb;
        return a.organizationName.localeCompare(b.organizationName);
      });
  }, [nowMs, orgLookup, organizations, sessions, sites, user.organizationId, user.organizationName, user.role]);

  const tenantTotals = useMemo(() => {
    return tenantMetrics.reduce(
      (acc, m) => {
        if (m.activeSessions > 0) acc.activeTenants += 1;
        acc.activeSessions += m.activeSessions;
        acc.activeMb += m.activeTotalMb;
        acc.durationSec += m.totalActiveDurationSec;
        return acc;
      },
      { activeTenants: 0, activeSessions: 0, activeMb: 0, durationSec: 0 }
    );
  }, [tenantMetrics]);

  const siteMetrics = useMemo<RouterSiteMetrics[]>(() => {
    const map = new Map<string, RouterSiteMetrics>();

    for (const site of sites) {
      if (selectedOrgId !== 'all' && site.organizationId !== selectedOrgId) continue;
      const siteRouter = routers.find((r) => r.siteId === site.id);
      map.set(site.id, {
        siteId: site.id,
        organizationId: site.organizationId,
        siteName: site.name,
        routerName: siteRouter?.name || 'NAS-UNASSIGNED',
        activeUsers: 0,
        totalSessions: 0,
        downloadMb: 0,
        uploadMb: 0,
        totalMb: 0,
      });
    }

    for (const session of sessions) {
      if (selectedOrgId !== 'all' && session.organizationId !== selectedOrgId) continue;
      const existing = map.get(session.siteId) || {
        siteId: session.siteId,
        organizationId: session.organizationId,
        siteName: session.siteName,
        routerName: session.routerName,
        activeUsers: 0,
        totalSessions: 0,
        downloadMb: 0,
        uploadMb: 0,
        totalMb: 0,
      };
      existing.totalSessions += 1;
      if (session.status === 'Active') {
        existing.activeUsers += 1;
      }
      existing.downloadMb += session.downloadMb;
      existing.uploadMb += session.uploadMb;
      existing.totalMb = existing.downloadMb + existing.uploadMb;
      map.set(session.siteId, existing);
    }

    return Array.from(map.values()).filter(
      (m) => m.totalSessions > 0 || sites.some((s) => s.id === m.siteId)
    );
  }, [routers, selectedOrgId, sessions, sites]);

  const handleSelectTenant = (orgId: string) => {
    const nextOrgId = selectedOrgId === orgId ? 'all' : orgId;
    setSelectedOrgId(nextOrgId);
    if (nextOrgId !== 'all' && selectedSiteId !== 'all') {
      const siteBelongs = sites.some((s) => s.id === selectedSiteId && s.organizationId === nextOrgId);
      if (!siteBelongs) {
        setSelectedSiteId('all');
      }
    }
  };

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (selectedOrgId !== 'all' && s.organizationId !== selectedOrgId) return false;
      if (selectedSiteId !== 'all' && s.siteId !== selectedSiteId) return false;
      if (statusFilter !== 'All' && s.status !== statusFilter) return false;
      if (q) {
        const tenantName = resolveOrgName(s).toLowerCase();
        return (
          s.username.toLowerCase().includes(q) ||
          s.voucherCode.toLowerCase().includes(q) ||
          s.framedIp.toLowerCase().includes(q) ||
          s.macAddress.toLowerCase().includes(q) ||
          s.routerName.toLowerCase().includes(q) ||
          s.siteName.toLowerCase().includes(q) ||
          tenantName.includes(q)
        );
      }
      return true;
    });
  }, [resolveOrgName, searchQuery, selectedOrgId, selectedSiteId, sessions, statusFilter]);

  const totals = useMemo(() => {
    return filteredSessions.reduce(
      (acc, s) => {
        if (s.status === 'Active') {
          acc.activeCount += 1;
          acc.totalDurationSec += getSessionDurationSeconds(s, nowMs);
        }
        acc.downloadMb += s.downloadMb;
        acc.uploadMb += s.uploadMb;
        return acc;
      },
      { activeCount: 0, downloadMb: 0, uploadMb: 0, totalDurationSec: 0 }
    );
  }, [filteredSessions, nowMs]);

  const handleDisconnect = async (session: RadiusSession) => {
    setDisconnectingId(session.id);
    try {
      await disconnectSession(session.id);
      if (onAfterDisconnect) {
        await onAfterDisconnect();
      }
      notify(`FreeRADIUS CoA Disconnect-Request sent to ${session.routerName} (${session.voucherCode}).`);
    } finally {
      setDisconnectingId(null);
    }
  };

  const displayedRows = compact ? filteredSessions.slice(0, 8) : filteredSessions;
  const maxTenantMb = Math.max(...tenantMetrics.map((m) => m.activeTotalMb), 1);

  return (
    <div className="space-y-4">
      {/* Per-Tenant Real-Time FreeRADIUS Breakdown */}
      {showTenantBreakdown && (
        <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Active FreeRADIUS Usage &amp; Duration per Tenant
                </h3>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {tenantTotals.activeTenants} active tenant(s) · {tenantTotals.activeSessions} session(s) ·{' '}
                  {formatDataMb(tenantTotals.activeMb)} · {formatDurationSeconds(tenantTotals.durationSec)} total
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Live subscriber throughput and connection time aggregated across FreeRADIUS NAS sites per tenant organization
              </p>
            </div>
            {selectedOrgId !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedOrgId('all')}
                className="text-xs font-semibold text-blue-700 hover:underline self-start sm:self-center cursor-pointer"
              >
                Show all tenants
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Tenant Organization</th>
                  <th className="py-2.5 px-4 text-right">Active Sessions</th>
                  <th className="py-2.5 px-4 text-right">Download (Rx)</th>
                  <th className="py-2.5 px-4 text-right">Upload (Tx)</th>
                  <th className="py-2.5 px-4 text-right">Active Data Usage</th>
                  <th className="py-2.5 px-4 text-right">Total Duration</th>
                  <th className="py-2.5 px-4 text-right">Avg · Longest</th>
                  <th className="py-2.5 px-4 text-right">Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tenantMetrics.map((m) => {
                  const isSelected = selectedOrgId === m.organizationId;
                  const sharePct =
                    m.activeTotalMb > 0 ? Math.max(4, Math.round((m.activeTotalMb / maxTenantMb) * 100)) : 0;
                  return (
                    <tr
                      key={m.organizationId}
                      onClick={() => handleSelectTenant(m.organizationId)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-2.5 px-4">
                        <div className="text-xs font-semibold text-slate-900">{m.organizationName}</div>
                        <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                          {m.plan || 'Tenant'} · {m.totalSessions} session(s) logged
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                          {m.activeSessions}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums mt-0.5">
                          {m.activeSitesCount} site(s)
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                        {formatDataMb(m.activeDownloadMb)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                        {formatDataMb(m.activeUploadMb)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {formatDataMb(m.activeTotalMb)}
                        </div>
                        <div className="w-20 ml-auto h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
                          <div className="h-full bg-blue-700" style={{ width: `${sharePct}%` }} />
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {m.activeSessions > 0 ? formatDurationSeconds(m.totalActiveDurationSec) : '00:00:00'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-[11px] text-slate-600 tabular-nums">
                        {m.activeSessions > 0
                          ? `${formatDurationSeconds(m.avgActiveDurationSec)} · max ${formatDurationSeconds(m.longestActiveDurationSec)}`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span
                          className={`text-xs font-semibold ${
                            isSelected ? 'text-blue-700' : 'text-slate-500'
                          }`}
                        >
                          {isSelected ? 'Filtered' : 'Filter'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {tenantMetrics.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-xs text-slate-500">
                      No tenant organizations or RADIUS sessions recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per Router Site Usage Strip */}
      {siteMetrics.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {siteMetrics.map((metric) => {
            const isSelected = selectedSiteId === metric.siteId;
            return (
              <button
                key={metric.siteId}
                type="button"
                onClick={() => setSelectedSiteId(isSelected ? 'all' : metric.siteId)}
                className={`text-left border rounded-lg p-4 transition-colors cursor-pointer bg-white ${
                  isSelected ? 'border-blue-700 ring-1 ring-blue-700/20' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{metric.siteName}</div>
                    <div className="font-mono text-[11px] text-slate-500 mt-0.5">{metric.routerName}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-lg font-bold text-slate-900 tabular-nums leading-none">
                      {metric.activeUsers}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">active user(s)</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-slate-600">
                    Rx {formatDataMb(metric.downloadMb)} · Tx {formatDataMb(metric.uploadMb)}
                  </span>
                  <span className="font-semibold text-slate-900">{formatDataMb(metric.totalMb)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Live Session Monitoring Table Card */}
      <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="font-display text-base font-bold text-slate-900">Real-Time FreeRADIUS Session Monitor</h2>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {totals.activeCount} active · {formatDataMb(totals.downloadMb + totals.uploadMb)} traffic ·{' '}
                {formatDurationSeconds(totals.totalDurationSec)} active time
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isPaused
                ? 'Polling paused'
                : `Auto-polling FreeRADIUS Acct-Interim-Update every ${pollIntervalMs / 1000}s`}
              {lastUpdatedAt && (
                <>
                  {' '}
                  · Last sync{' '}
                  <span className="font-mono tabular-nums">
                    {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Polling interval"
              value={pollIntervalMs}
              onChange={(e) => setPollIntervalMs(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white text-slate-700"
            >
              <option value={3000}>Poll: 3s</option>
              <option value={5000}>Poll: 5s</option>
              <option value={10000}>Poll: 10s</option>
            </select>

            <button
              type="button"
              onClick={togglePause}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-700" /> : <Pause className="w-3.5 h-3.5 text-amber-700" />}
              <span>{isPaused ? 'Resume' : 'Pause'}</span>
            </button>

            <button
              type="button"
              disabled={isPolling}
              onClick={() => void refreshNow()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`} />
              <span>{isPolling ? 'Syncing...' : 'Sync Now'}</span>
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-md">
              {(['Active', 'All', 'Disconnected'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusFilter(tab)}
                  className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer transition-colors ${
                    statusFilter === tab ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {showTenantBreakdown && tenantMetrics.length > 0 && (
              <select
                aria-label="Filter by tenant organization"
                value={selectedOrgId}
                onChange={(e) => {
                  const nextOrgId = e.target.value;
                  setSelectedOrgId(nextOrgId);
                  if (nextOrgId !== 'all' && selectedSiteId !== 'all') {
                    const siteBelongs = sites.some((s) => s.id === selectedSiteId && s.organizationId === nextOrgId);
                    if (!siteBelongs) setSelectedSiteId('all');
                  }
                }}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
              >
                <option value="all">All Tenants ({tenantMetrics.length})</option>
                {tenantMetrics.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organizationName} ({m.activeSessions} active)
                  </option>
                ))}
              </select>
            )}

            <select
              aria-label="Filter by router site"
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
            >
              <option value="all">All Router Sites ({siteMetrics.length})</option>
              {siteMetrics.map((m) => (
                <option key={m.siteId} value={m.siteId}>
                  {m.siteName} · {m.routerName}
                </option>
              ))}
            </select>
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter user, voucher, tenant, IP, MAC..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
            />
          </div>
        </div>

        {error && (
          <div className="px-5 py-2.5 bg-red-50 border-b border-red-200 text-xs text-red-700">
            Session polling error: {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Active WiFi User · Voucher</th>
                {showTenantBreakdown && <th className="py-2.5 px-4">Tenant</th>}
                <th className="py-2.5 px-4">IP / MAC Address</th>
                <th className="py-2.5 px-4">Router Site · NAS</th>
                <th className="py-2.5 px-4 text-right">Connection Duration</th>
                <th className="py-2.5 px-4 text-right">Data Usage (Rx / Tx)</th>
                <th className="py-2.5 px-4">Status</th>
                {canDisconnect && <th className="py-2.5 px-4 text-right">Control</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedRows.map((s) => {
                const totalMb = s.downloadMb + s.uploadMb;
                const rxPercent = totalMb > 0 ? Math.round((s.downloadMb / totalMb) * 100) : 0;
                const tenantName = resolveOrgName(s);
                return (
                  <tr key={s.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-xs font-semibold text-slate-900">{s.username}</div>
                      <div className="font-mono text-[11px] text-blue-700 mt-0.5">{s.voucherCode}</div>
                    </td>
                    {showTenantBreakdown && (
                      <td className="py-2.5 px-4">
                        <div className="text-xs font-medium text-slate-900">{tenantName}</div>
                        <div className="font-mono text-[11px] text-slate-400 mt-0.5">{s.organizationId}</div>
                      </td>
                    )}
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-xs text-slate-800 tabular-nums">{s.framedIp}</div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums mt-0.5">{s.macAddress}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-xs font-medium text-slate-900">{s.siteName}</div>
                      <div className="font-mono text-[11px] text-slate-500 mt-0.5">{s.routerName}</div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {formatElapsedTime(s, nowMs)}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums mt-0.5">
                        {s.status === 'Active' ? `${s.remainingMinutes} min left` : 'Session closed'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {formatDataMb(totalMb)}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums mt-0.5">
                        ↓ {s.downloadMb.toFixed(1)} · ↑ {s.uploadMb.toFixed(1)} MB
                      </div>
                      <div className="w-24 ml-auto h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-blue-700" style={{ width: `${rxPercent}%` }} />
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusText status={s.status} />
                    </td>
                    {canDisconnect && (
                      <td className="py-2.5 px-4 text-right">
                        {s.status === 'Active' ? (
                          <button
                            type="button"
                            disabled={disconnectingId === s.id}
                            onClick={() => void handleDisconnect(s)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            <PowerOff className="w-3.5 h-3.5" />
                            <span>{disconnectingId === s.id ? 'Dropping...' : 'CoA Drop'}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {displayedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={(showTenantBreakdown ? 7 : 6) + (canDisconnect ? 1 : 0)}
                    className="py-8 text-center text-xs text-slate-500"
                  >
                    No FreeRADIUS WiFi sessions match the current tenant, router site, or search filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
