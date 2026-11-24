import React, { useState } from 'react';
import { Copy, Check, Plus, RefreshCw, Play, FileCode2, FileDown, SlidersHorizontal, X } from 'lucide-react';
import type {
  AgentRecord,
  AuditLogEntry,
  CommissionEntry,
  DailyMetricPoint,
  HotspotPackage,
  Organization,
  PaymentGatewayConfig,
  PaymentTransaction,
  PublicUser,
  RadiusSession,
  RouterDevice,
  Site,
  SupportTicket,
  Voucher,
  WorkerJobState,
} from '../../../packages/shared/types';
import { apiRequest } from '../../services/api';
import { StatusText } from '../../components/ui/StatusText';
import { RevenueAndSessionsChart } from '../../components/dashboard/RevenueAndSessionsChart';
import { LiveSessionMonitorTable } from '../../components/dashboard/LiveSessionMonitorTable';
import { PaymentGatewaysPanel } from '../../components/dashboard/PaymentGatewaysPanel';
import { AddRouterWizard } from '../../components/dashboard/AddRouterWizard';
import { RouterAutoScriptPanel } from '../../components/dashboard/RouterAutoScriptPanel';
import { RouterTopologyMap } from '../../components/dashboard/RouterTopologyMap';
import { RouterAlertsPanel } from '../../components/dashboard/RouterAlertsPanel';
import { downloadVouchersPdf } from '../../utils/voucherPdf';

export interface DashboardBundle {
  overview: {
    kpis: {
      totalRevenueTzs: number;
      activeSessions: number;
      onlineRouters: number;
      totalRouters: number;
      availableVouchers: number;
      openTickets: number;
      activeAgents: number;
      totalSites: number;
    };
    hourlyTraffic: { hour: string; mbps: number; sales: number }[];
    dailyMetrics: DailyMetricPoint[];
  };
  organizations: Organization[];
  sites: Site[];
  routers: RouterDevice[];
  packages: HotspotPackage[];
  vouchers: Voucher[];
  sessions: RadiusSession[];
  payments: PaymentTransaction[];
  gateways: PaymentGatewayConfig[];
  agents: AgentRecord[];
  commissions: CommissionEntry[];
  tickets: SupportTicket[];
  auditLogs: AuditLogEntry[];
  workerJobs: WorkerJobState[];
}

interface ViewProps {
  user: PublicUser;
  token: string;
  data: DashboardBundle;
  refresh: () => Promise<void>;
  notify: (msg: string) => void;
}

export function OverviewSection({ user, token, data, refresh, notify }: ViewProps) {
  const { kpis, hourlyTraffic, dailyMetrics } = data.overview;
  const maxMbps = Math.max(...hourlyTraffic.map((h) => h.mbps), 1);

  const cards =
    user.role === 'customer'
      ? [
          { label: 'Active WiFi Sessions', value: String(data.sessions.filter((s) => s.status === 'Active').length) },
          { label: 'My Vouchers', value: String(data.vouchers.length) },
          { label: 'DaliPay Receipts', value: String(data.payments.length) },
          { label: 'Support Tickets', value: String(data.tickets.length) },
        ]
      : user.role === 'agent'
      ? [
          { label: 'Available Vouchers', value: String(kpis.availableVouchers) },
          { label: 'Pending Commission', value: `TZS ${(data.agents[0]?.pendingPayoutTzs ?? 0).toLocaleString()}` },
          { label: 'Total Paid Out', value: `TZS ${(data.agents[0]?.paidOutTzs ?? 0).toLocaleString()}` },
          { label: 'Vouchers Sold', value: String(data.agents[0]?.vouchersSold ?? 0) },
        ]
      : [
          { label: 'Monthly Revenue', value: `TZS ${kpis.totalRevenueTzs.toLocaleString()}` },
          { label: 'Active RADIUS Sessions', value: String(kpis.activeSessions) },
          { label: 'Synced Routers', value: `${kpis.onlineRouters} / ${kpis.totalRouters}` },
          { label: 'Open Support Tickets', value: String(kpis.openTickets) },
        ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 bg-white rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        {cards.map((c) => (
          <div key={c.label} className="p-5">
            <div className="text-xs font-medium text-slate-500">{c.label}</div>
            <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      {(user.role === 'admin' || user.role === 'super-admin') && (
        <RevenueAndSessionsChart data={dailyMetrics || []} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 border border-slate-200 bg-white rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Aggregate Hotspot Throughput</h2>
              <p className="text-xs text-slate-500">Peak Mbps &amp; voucher clearings by 3-hour window</p>
            </div>
            <span className="text-xs font-mono text-slate-500">24h Window</span>
          </div>
          <div className="grid grid-cols-6 gap-4 items-end h-44 pt-4">
            {hourlyTraffic.map((bar) => {
              const heightPct = Math.max(12, Math.round((bar.mbps / maxMbps) * 100));
              return (
                <div key={bar.hour} className="flex flex-col items-center h-full justify-end gap-2">
                  <span className="font-mono text-[11px] text-slate-600 tabular-nums">{bar.mbps}</span>
                  <div className="w-full max-w-[40px] bg-slate-100 rounded-t-sm h-full flex items-end overflow-hidden">
                    <div
                      className="w-full bg-blue-700 rounded-t-sm transition-all"
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">{bar.hour}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-5 border border-slate-200 bg-white rounded-lg p-6">
          <h2 className="font-display text-base font-bold text-slate-900 mb-4">Recent System Events</h2>
          <div className="divide-y divide-slate-100">
            {data.auditLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-slate-900">{log.action}</div>
                  <div className="text-slate-500 mt-0.5">{log.target}</div>
                </div>
                <span className="font-mono text-slate-400 shrink-0 tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            {data.auditLogs.length === 0 && (
              <p className="text-xs text-slate-500 py-4">No recent system events for this scope.</p>
            )}
          </div>
        </div>
      </div>

      {user.role !== 'agent' && (
        <LiveSessionMonitorTable
          user={user}
          token={token}
          initialSessions={data.sessions}
          sites={data.sites}
          routers={data.routers}
          organizations={data.organizations}
          onAfterDisconnect={refresh}
          notify={notify}
          compact
        />
      )}
    </div>
  );
}

export function OrganizationsSection({ token, data, refresh, notify }: ViewProps) {
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<'Starter' | 'Regional ISP' | 'Carrier Multi-Tenant'>('Regional ISP');
  const [country, setCountry] = useState('Tanzania');
  const [submitting, setSubmitting] = useState(false);

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/api/organizations', {
        method: 'POST',
        token,
        body: { name, plan, country },
      });
      setName('');
      await refresh();
      notify('Organization tenant provisioned.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleOrg = async (id: string) => {
    await apiRequest(`/api/organizations/${id}/toggle`, { method: 'PATCH', token });
    await refresh();
    notify('Tenant status updated.');
  };

  return (
    <div className="space-y-6">
      <form onSubmit={createOrg} className="border border-slate-200 bg-white rounded-lg p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Organization Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Savannah Wireless Ltd" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Plan Tier</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value as 'Starter' | 'Regional ISP' | 'Carrier Multi-Tenant')} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white">
            <option value="Starter">Starter</option>
            <option value="Regional ISP">Regional ISP</option>
            <option value="Carrier Multi-Tenant">Carrier Multi-Tenant</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Country</label>
          <input value={country} onChange={(e) => setCountry(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md" />
        </div>
        <button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer">
          <Plus className="w-4 h-4" />
          <span>Add Tenant</span>
        </button>
      </form>

      <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="py-2.5 px-4">Tenant</th>
              <th className="py-2.5 px-4">Plan</th>
              <th className="py-2.5 px-4">Country</th>
              <th className="py-2.5 px-4 text-right">Monthly Revenue</th>
              <th className="py-2.5 px-4">Status</th>
              <th className="py-2.5 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.organizations.map((org) => (
              <tr key={org.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-4 font-medium text-slate-900">{org.name}</td>
                <td className="py-2.5 px-4 text-slate-600">{org.plan}</td>
                <td className="py-2.5 px-4 text-slate-600">{org.country}</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900">
                  TZS {org.monthlyRevenueTzs.toLocaleString()}
                </td>
                <td className="py-2.5 px-4">
                  <StatusText status={org.status} />
                </td>
                <td className="py-2.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => toggleOrg(org.id)}
                    className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    {org.status === 'Active' ? 'Suspend' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {data.organizations.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  No tenant organizations created yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SitesAndRoutersSection({ user, token, data, refresh, notify }: ViewProps) {
  const [siteForm, setSiteForm] = useState({ name: '', location: '', ssid: '' });
  const [showRouterWizard, setShowRouterWizard] = useState(false);
  const [autoScriptTarget, setAutoScriptTarget] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [setupForm, setSetupForm] = useState({
    ssid: '',
    captivePortalTitle: '',
    hotspotEnabled: true,
    voucherPdfEnabled: true,
    walledGardenText: '',
  });
  const [savingSetup, setSavingSetup] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const canCreate = user.role === 'super-admin' || user.role === 'admin' || user.role === 'support';
  const canCreateSite = user.role === 'super-admin' || user.role === 'admin';

  const openHotspotSetup = (site: Site) => {
    setEditingSite(site);
    setSetupForm({
      ssid: site.ssid,
      captivePortalTitle: site.captivePortalTitle,
      hotspotEnabled: site.hotspotEnabled,
      voucherPdfEnabled: site.voucherPdfEnabled,
      walledGardenText: (site.walledGardenHosts || []).join(', '),
    });
  };

  const saveHotspotSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSite) return;
    setSavingSetup(true);
    try {
      const walledGardenHosts = setupForm.walledGardenText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiRequest(`/api/sites/${editingSite.id}/hotspot-setup`, {
        method: 'PATCH',
        token,
        body: {
          ssid: setupForm.ssid,
          captivePortalTitle: setupForm.captivePortalTitle,
          hotspotEnabled: setupForm.hotspotEnabled,
          voucherPdfEnabled: setupForm.voucherPdfEnabled,
          walledGardenHosts,
        },
      });
      await refresh();
      setEditingSite(null);
      notify(`Hotspot setup updated for ${editingSite.name}.`);
    } finally {
      setSavingSetup(false);
    }
  };

  const createSite = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/sites', { method: 'POST', token, body: siteForm });
    setSiteForm({ name: '', location: '', ssid: '' });
    await refresh();
    notify('Hotspot site added.');
  };

  const syncRouter = async (id: string) => {
    setSyncingId(id);
    try {
      await apiRequest(`/api/routers/${id}/sync`, { method: 'POST', token });
      await refresh();
      notify('Router hardware telemetry synced.');
    } finally {
      setSyncingId(null);
    }
  };

  const buildRouterOsSnippet = () => {
    const hosts = (setupForm.walledGardenText || 'portal.xcloud.co.tz, api.dalipay.co.tz')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    const walledLines = hosts
      .map((h) => `/ip hotspot walled-garden add dst-host="${h}" action=allow`)
      .join('\n');
    return [
      `/ip hotspot profile set [find default=yes] html-directory=hotspot login-by=http-chap,http-pap use-radius=yes`,
      `/radius add service=hotspot address=10.66.0.1 secret="<SET_RADIUS_SHARED_SECRET>" timeout=3000ms`,
      `/ip hotspot set [find] disabled=${setupForm.hotspotEnabled ? 'no' : 'yes'}`,
      walledLines,
    ].join('\n');
  };

  return (
    <div className="space-y-6">
      {canCreate && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {canCreateSite && (
            <form onSubmit={createSite} className="border border-slate-200 bg-white rounded-lg p-5 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-900">Add Hotspot Site</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input required value={siteForm.name} onChange={(e) => setSiteForm((s) => ({ ...s, name: e.target.value }))} placeholder="Site Name" className="px-3 py-2 text-xs border border-slate-300 rounded-md" />
                <input required value={siteForm.location} onChange={(e) => setSiteForm((s) => ({ ...s, location: e.target.value }))} placeholder="City / Address" className="px-3 py-2 text-xs border border-slate-300 rounded-md" />
                <input required value={siteForm.ssid} onChange={(e) => setSiteForm((s) => ({ ...s, ssid: e.target.value }))} placeholder="Broadcast SSID" className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-md" />
              </div>
              <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer">
                Create Hotspot Site
              </button>
            </form>
          )}

          <div className={`border border-slate-200 bg-white rounded-lg p-5 flex flex-col justify-between gap-3 ${!canCreateSite ? 'lg:col-span-2' : ''}`}>
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">Provision MikroTik / Omada Router</h3>
              <p className="text-xs text-slate-500 mt-1">
                Step-by-step hardware onboarding with API credential validation, connection probe, and auto-generated WireGuard, Bridge, Hotspot, and Captive Portal script.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                {data.sites.length === 0 ? 'Create a hotspot site first to bind a router.' : `${data.sites.length} site(s) available for binding`}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {data.routers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAutoScriptTarget((prev) => (prev === 'all' ? null : 'all'))}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
                  >
                    <FileCode2 className="w-3.5 h-3.5 text-blue-700" />
                    <span>{autoScriptTarget === 'all' ? 'Hide Auto-Provision Scripts' : 'Auto-Provision All Scripts'}</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={data.sites.length === 0}
                  onClick={() => setShowRouterWizard((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showRouterWizard ? 'Hide Add Router Wizard' : 'Add Router Wizard'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRouterWizard && (
        <AddRouterWizard
          token={token}
          sites={data.sites}
          onClose={() => setShowRouterWizard(false)}
          onCreated={async () => {
            setShowRouterWizard(false);
            await refresh();
          }}
          notify={notify}
        />
      )}

      {autoScriptTarget !== null && (
        <RouterAutoScriptPanel
          key={autoScriptTarget}
          token={token}
          routers={data.routers}
          sites={data.sites}
          initialRouterId={autoScriptTarget}
          onClose={() => setAutoScriptTarget(null)}
          notify={notify}
        />
      )}

      {/* Hotspot Setup & Voucher PDF Policy Table */}
      <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">Hotspot Sites &amp; Captive Setup</h3>
            <p className="text-xs text-slate-500">Configure SSID broadcast, FreeRADIUS hotspot enablement, walled garden, and Voucher PDF output</p>
          </div>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="py-2.5 px-4">Site Name</th>
              <th className="py-2.5 px-4">SSID</th>
              <th className="py-2.5 px-4">Hotspot Portal</th>
              <th className="py-2.5 px-4">Voucher PDF</th>
              <th className="py-2.5 px-4 text-right">Active Users</th>
              <th className="py-2.5 px-4 text-right">Setup</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.sites.map((site) => (
              <tr key={site.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-4">
                  <div className="font-semibold text-xs text-slate-900">{site.name}</div>
                  <div className="text-xs text-slate-500">{site.location}</div>
                </td>
                <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{site.ssid}</td>
                <td className="py-2.5 px-4">
                  <StatusText status={site.hotspotEnabled ? 'Active' : 'Paused'} />
                </td>
                <td className="py-2.5 px-4">
                  <StatusText status={site.voucherPdfEnabled ? 'Active' : 'Paused'} />
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">{site.activeUsers}</td>
                <td className="py-2.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => openHotspotSetup(site)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Hotspot Setup</span>
                  </button>
                </td>
              </tr>
            ))}
            {data.sites.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  No hotspot sites configured yet. Add a site above to start broadcasting.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Inline Hotspot Setup Drawer / Panel */}
      {editingSite && (
        <div className="border border-blue-700 bg-white rounded-lg p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Hotspot Setup · {editingSite.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Adjust captive portal parameters, walled-garden hosts, Voucher PDF permissions, and copy MikroTik RouterOS script.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingSite(null)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer p-1"
              aria-label="Close hotspot setup"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={saveHotspotSetup} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Broadcast SSID</label>
                <input
                  required
                  value={setupForm.ssid}
                  onChange={(e) => setSetupForm((s) => ({ ...s, ssid: e.target.value }))}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Captive Portal Heading</label>
                <input
                  required
                  value={setupForm.captivePortalTitle}
                  onChange={(e) => setSetupForm((s) => ({ ...s, captivePortalTitle: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Walled-Garden Allowed Hosts (comma-separated)
              </label>
              <input
                value={setupForm.walledGardenText}
                onChange={(e) => setSetupForm((s) => ({ ...s, walledGardenText: e.target.value }))}
                placeholder="portal.xcloud.co.tz, api.dalipay.co.tz, mpesa.vodacom.co.tz"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={setupForm.hotspotEnabled}
                  onChange={(e) => setSetupForm((s) => ({ ...s, hotspotEnabled: e.target.checked }))}
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                <span>Enable Captive Portal Hotspot</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={setupForm.voucherPdfEnabled}
                  onChange={(e) => setSetupForm((s) => ({ ...s, voucherPdfEnabled: e.target.checked }))}
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                <span>Enable Printable Voucher PDF Export</span>
              </label>
            </div>

            <div className="bg-slate-950 text-slate-100 rounded-md p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">MikroTik RouterOS v7 Hotspot + FreeRADIUS Script</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(buildRouterOsSnippet()).catch(() => {});
                    setCopiedScript(true);
                    setTimeout(() => setCopiedScript(false), 1500);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 hover:text-white cursor-pointer"
                >
                  {copiedScript ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedScript ? 'Copied' : 'Copy Script'}</span>
                </button>
              </div>
              <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                {buildRouterOsSnippet()}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingSite(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingSetup}
                className="px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer"
              >
                {savingSetup ? 'Saving Setup...' : 'Save Hotspot Setup'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="py-2.5 px-4">Router Host</th>
              <th className="py-2.5 px-4">Vendor · Model</th>
              <th className="py-2.5 px-4">Site</th>
              <th className="py-2.5 px-4">WireGuard · Bridge</th>
              <th className="py-2.5 px-4 text-right">CPU</th>
              <th className="py-2.5 px-4 text-right">Latency</th>
              <th className="py-2.5 px-4 text-right">Leases</th>
              <th className="py-2.5 px-4">Status</th>
              <th className="py-2.5 px-4 text-right">Telemetry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.routers.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-4">
                  <div className="font-mono text-xs font-semibold text-slate-900">{r.name}</div>
                  <div className="font-mono text-[11px] text-slate-500">{r.ipAddress}:{r.apiPort}</div>
                </td>
                <td className="py-2.5 px-4 text-xs text-slate-600">
                  {r.vendor} · {r.model}
                </td>
                <td className="py-2.5 px-4 text-xs text-slate-700">{r.siteName}</td>
                <td className="py-2.5 px-4">
                  <div className="font-mono text-xs text-slate-700">{r.wireguardTunnelIp}</div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {r.bridgeName || 'bridge-hotspot'} · {r.hotspotSubnet || '10.5.50.0/24'}
                  </div>
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">{r.cpuPercent}%</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-700">
                  {typeof r.latencyMs === 'number' ? `${r.latencyMs} ms` : '—'}
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">{r.activeLeases}</td>
                <td className="py-2.5 px-4">
                  <StatusText status={r.status} />
                  {r.lastError && (
                    <div className="font-mono text-[11px] text-red-700 mt-0.5 max-w-[200px] truncate" title={r.lastError}>
                      {r.lastError}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <div className="inline-flex items-center justify-end gap-3">
                    {canCreate && (
                      <button
                        type="button"
                        onClick={() => setAutoScriptTarget(r.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-blue-700 hover:underline cursor-pointer"
                      >
                        <FileCode2 className="w-3.5 h-3.5" />
                        <span>Auto-Script</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={syncingId === r.id}
                      onClick={() => syncRouter(r.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingId === r.id ? 'animate-spin' : ''}`} />
                      <span>Sync</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {data.routers.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-xs text-slate-500">
                  No MikroTik or Omada NAS routers registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PackagesSection({ user, token, data, refresh, notify }: ViewProps) {
  const [form, setForm] = useState({ name: '', durationMinutes: '60', downloadMbps: '50', uploadMbps: '20', priceTzs: '1000', deviceLimit: '1' });

  const createPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/packages', { method: 'POST', token, body: form });
    setForm({ name: '', durationMinutes: '60', downloadMbps: '50', uploadMbps: '20', priceTzs: '1000', deviceLimit: '1' });
    await refresh();
    notify('Hotspot package created.');
  };

  return (
    <div className="space-y-6">
      {(user.role === 'admin' || user.role === 'super-admin') && (
        <form onSubmit={createPackage} className="border border-slate-200 bg-white rounded-lg p-5 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div className="col-span-2 md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Package Name</label>
            <input required value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="1 Hour Express 50M" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Minutes</label>
            <input type="number" required value={form.durationMinutes} onChange={(e) => setForm((s) => ({ ...s, durationMinutes: e.target.value }))} className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Down Mbps</label>
            <input type="number" required value={form.downloadMbps} onChange={(e) => setForm((s) => ({ ...s, downloadMbps: e.target.value }))} className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Price (TZS)</label>
            <input type="number" required value={form.priceTzs} onChange={(e) => setForm((s) => ({ ...s, priceTzs: e.target.value }))} className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md" />
          </div>
          <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer">
            Add Plan
          </button>
        </form>
      )}

      <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="py-2.5 px-4">Package</th>
              <th className="py-2.5 px-4">Duration</th>
              <th className="py-2.5 px-4">Speed Profile</th>
              <th className="py-2.5 px-4">Data Cap</th>
              <th className="py-2.5 px-4 text-right">Devices</th>
              <th className="py-2.5 px-4 text-right">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.packages.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-4 font-semibold text-slate-900">{p.name}</td>
                <td className="py-2.5 px-4 text-xs text-slate-600">{p.durationLabel}</td>
                <td className="py-2.5 px-4 font-mono text-xs text-slate-700">
                  {p.downloadMbps}/{p.uploadMbps} Mbps
                </td>
                <td className="py-2.5 px-4 text-xs text-slate-600">{p.dataCapGb ? `${p.dataCapGb} GB` : 'Unlimited'}</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">{p.deviceLimit}</td>
                <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                  TZS {p.priceTzs.toLocaleString()}
                </td>
              </tr>
            ))}
            {data.packages.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  No internet packages created yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function VouchersSection({ user, token, data, refresh, notify }: ViewProps) {
  const [siteId, setSiteId] = useState(data.sites[0]?.id || '');
  const [packageId, setPackageId] = useState(data.packages[0]?.id || '');
  const [quantity, setQuantity] = useState('5');
  const [customerPhone, setCustomerPhone] = useState('');
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [lastBatch, setLastBatch] = useState<{ batchId: string; vouchers: Voucher[] } | null>(null);

  const canIssue = ['super-admin', 'admin', 'agent'].includes(user.role);
  const sitePdfLookup = new Map(data.sites.map((s) => [s.id, s.voucherPdfEnabled]));

  const effectiveSiteId = siteId || data.sites[0]?.id || '';
  const effectivePackageId = packageId || data.packages[0]?.id || '';

  const generateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiRequest<{ batchId: string; vouchers: Voucher[] }>('/api/vouchers/batch', {
      method: 'POST',
      token,
      body: { siteId: effectiveSiteId, packageId: effectivePackageId, quantity: Number(quantity), customerPhone },
    });
    setCustomerPhone('');
    setLastBatch(res);
    await refresh();
    notify(`Generated ${res.vouchers.length} voucher(s) in ${res.batchId}.`);
  };

  const revokeVoucher = async (id: string) => {
    await apiRequest(`/api/vouchers/${id}/revoke`, { method: 'POST', token });
    await refresh();
    notify('Voucher revoked.');
  };

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  };

  const visible = data.vouchers.filter((v) => {
    if (filter !== 'All' && v.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return v.code.toLowerCase().includes(q) || v.packageName.toLowerCase().includes(q) || (v.redeemedByPhone || '').includes(q);
    }
    return true;
  });

  const printableVouchers = visible.filter((v) => sitePdfLookup.get(v.siteId) !== false);

  const exportPdfList = (list: Voucher[], customFilename?: string) => {
    if (list.length === 0) {
      notify('No PDF-enabled vouchers available to export.');
      return;
    }
    downloadVouchersPdf({
      vouchers: list,
      sites: data.sites,
      organizationName: user.organizationName,
      filename: customFilename,
    });
    notify(`Downloaded PDF sheet with ${list.length} voucher(s).`);
  };

  return (
    <div className="space-y-6">
      {canIssue && (
        <form onSubmit={generateBatch} className="border border-slate-200 bg-white rounded-lg p-5 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Site</label>
            <select value={effectiveSiteId} onChange={(e) => setSiteId(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white">
              {data.sites.length === 0 ? (
                <option value="">No sites configured</option>
              ) : (
                data.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Package</label>
            <select value={effectivePackageId} onChange={(e) => setPackageId(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white">
              {data.packages.length === 0 ? (
                <option value="">No packages configured</option>
              ) : (
                data.packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (TZS {p.priceTzs.toLocaleString()})
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Quantity (1-25)</label>
            <input type="number" min={1} max={25} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Customer Phone (Optional)</label>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+255754..." className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md" />
          </div>
          <button
            type="submit"
            disabled={!effectiveSiteId || !effectivePackageId}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md cursor-pointer"
          >
            {user.role === 'agent' ? 'Sell & Issue Voucher' : 'Generate Batch'}
          </button>
        </form>
      )}

      {lastBatch && (() => {
        const printableBatch = lastBatch.vouchers.filter((v) => sitePdfLookup.get(v.siteId) !== false);
        return (
          <div className="border border-blue-200 bg-blue-50/50 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-800">
              Batch <span className="font-mono font-semibold">{lastBatch.batchId}</span> ready ({lastBatch.vouchers.length} voucher(s)).
              {printableBatch.length === 0 && (
                <span className="text-slate-500 ml-2">Voucher PDF export is disabled for this site in Hotspot Setup.</span>
              )}
            </div>
            {printableBatch.length > 0 && (
              <button
                type="button"
                onClick={() => exportPdfList(printableBatch, `xcloud-${lastBatch.batchId.toLowerCase()}.pdf`)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer self-start sm:self-auto"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>Download Batch PDF</span>
              </button>
            )}
          </div>
        );
      })()}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/60 rounded-lg self-start">
          {['All', 'Available', 'Active', 'Expired', 'Revoked'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                filter === tab ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search voucher code or phone..."
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white w-full sm:w-56"
          />
          <button
            type="button"
            disabled={printableVouchers.length === 0}
            onClick={() => exportPdfList(printableVouchers)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
          >
            <FileDown className="w-3.5 h-3.5 text-blue-700" />
            <span>Download Voucher PDF ({printableVouchers.length})</span>
          </button>
        </div>
      </div>

      <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="py-2.5 px-4">Voucher Code</th>
              <th className="py-2.5 px-4">Package</th>
              <th className="py-2.5 px-4">Site</th>
              <th className="py-2.5 px-4">Issued By</th>
              <th className="py-2.5 px-4 text-right">Value</th>
              <th className="py-2.5 px-4">Status</th>
              <th className="py-2.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((v) => {
              const pdfAllowed = sitePdfLookup.get(v.siteId) !== false;
              return (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-900">
                    <div className="flex items-center gap-2">
                      <span>{v.code}</span>
                      <button type="button" onClick={() => copyCode(v.code)} className="text-slate-400 hover:text-slate-700 cursor-pointer" title="Copy voucher code">
                        {copiedCode === v.code ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-700">{v.packageName}</td>
                  <td className="py-2.5 px-4 text-xs text-slate-600">{v.siteName}</td>
                  <td className="py-2.5 px-4 text-xs text-slate-500">{v.issuedBy}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">TZS {v.priceTzs.toLocaleString()}</td>
                  <td className="py-2.5 px-4">
                    <StatusText status={v.status} />
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="inline-flex items-center gap-3">
                      {pdfAllowed && (
                        <button
                          type="button"
                          onClick={() => exportPdfList([v], `voucher-${v.code.toLowerCase()}.pdf`)}
                          className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                        >
                          PDF
                        </button>
                      )}
                      {(user.role === 'admin' || user.role === 'super-admin') && v.status !== 'Revoked' && (
                        <button type="button" onClick={() => revokeVoucher(v.id)} className="text-xs font-semibold text-red-700 hover:underline cursor-pointer">
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                  No vouchers match the selected filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SessionsSection({ user, token, data, refresh, notify }: ViewProps) {
  return (
    <LiveSessionMonitorTable
      user={user}
      token={token}
      initialSessions={data.sessions}
      sites={data.sites}
      routers={data.routers}
      organizations={data.organizations}
      onAfterDisconnect={refresh}
      notify={notify}
    />
  );
}

export function PaymentsSection({ user, token, data, refresh, notify }: ViewProps) {
  const verifyPending = async (reference: string) => {
    await apiRequest(`/api/payments/${reference}/verify`, { method: 'POST', token });
    await refresh();
    notify(`Settled transaction ${reference} and issued voucher.`);
  };

  return (
    <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
          <tr>
            <th className="py-2.5 px-4">Reference</th>
            <th className="py-2.5 px-4">Gateway · Channel</th>
            <th className="py-2.5 px-4">Customer Phone</th>
            <th className="py-2.5 px-4">Package</th>
            <th className="py-2.5 px-4">Issued Voucher</th>
            <th className="py-2.5 px-4 text-right">Amount</th>
            <th className="py-2.5 px-4">Status</th>
            <th className="py-2.5 px-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.payments.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-900">{p.reference}</td>
              <td className="py-2.5 px-4 text-xs text-slate-700">
                {p.gatewayCode ? (
                  <span>
                    <span className="font-mono text-slate-500">{p.gatewayCode}</span> · {p.provider}
                  </span>
                ) : (
                  p.provider
                )}
              </td>
              <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{p.customerPhone}</td>
              <td className="py-2.5 px-4 text-xs text-slate-700">{p.packageName}</td>
              <td className="py-2.5 px-4 font-mono text-xs text-blue-700">{p.voucherCode || '—'}</td>
              <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold tabular-nums">
                TZS {p.amountTzs.toLocaleString()}
              </td>
              <td className="py-2.5 px-4">
                <StatusText status={p.status} />
              </td>
              <td className="py-2.5 px-4 text-right">
                {(user.role === 'admin' || user.role === 'super-admin') && p.status === 'Pending' && (
                  <button
                    type="button"
                    onClick={() => verifyPending(p.reference)}
                    className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    Confirm Settlement
                  </button>
                )}
              </td>
            </tr>
          ))}
          {data.payments.length === 0 && (
            <tr>
              <td colSpan={8} className="py-8 text-center text-xs text-slate-500">
                No mobile money or cash agent payment records yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function GatewaysSection({ user, token, data, refresh, notify }: ViewProps) {
  return (
    <PaymentGatewaysPanel
      user={user}
      token={token}
      gateways={data.gateways}
      organizations={data.organizations}
      refresh={refresh}
      notify={notify}
    />
  );
}

export function AgentsSection({ user, token, data, refresh, notify }: ViewProps) {
  const payout = async (id: string) => {
    await apiRequest(`/api/commissions/${id}/payout`, { method: 'POST', token });
    await refresh();
    notify('Agent commission marked as paid.');
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="py-2.5 px-4">Agent</th>
              <th className="py-2.5 px-4">Assigned Site</th>
              <th className="py-2.5 px-4 text-right">Rate</th>
              <th className="py-2.5 px-4 text-right">Vouchers Sold</th>
              <th className="py-2.5 px-4 text-right">Pending Payout</th>
              <th className="py-2.5 px-4 text-right">Paid Out</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.agents.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-4">
                  <div className="font-semibold text-slate-900 text-xs">{a.name}</div>
                  <div className="font-mono text-xs text-slate-500">{a.phone}</div>
                </td>
                <td className="py-2.5 px-4 text-xs text-slate-600">{a.siteName}</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">{a.commissionRatePercent}%</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">{a.vouchersSold}</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-amber-700 tabular-nums">
                  TZS {a.pendingPayoutTzs.toLocaleString()}
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-xs text-emerald-700 tabular-nums">
                  TZS {a.paidOutTzs.toLocaleString()}
                </td>
              </tr>
            ))}
            {data.agents.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  No reseller agents registered for this organization yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200 text-xs font-bold text-slate-900">Commission Ledger</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
            <tr>
              <th className="py-2.5 px-4">Agent</th>
              <th className="py-2.5 px-4">Voucher</th>
              <th className="py-2.5 px-4 text-right">Sale</th>
              <th className="py-2.5 px-4 text-right">Commission</th>
              <th className="py-2.5 px-4">Status</th>
              <th className="py-2.5 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.commissions.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="py-2.5 px-4 text-xs font-medium text-slate-900">{c.agentName}</td>
                <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{c.voucherCode}</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">TZS {c.saleAmountTzs.toLocaleString()}</td>
                <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold tabular-nums">TZS {c.commissionTzs.toLocaleString()}</td>
                <td className="py-2.5 px-4">
                  <StatusText status={c.status} />
                </td>
                <td className="py-2.5 px-4 text-right">
                  {(user.role === 'admin' || user.role === 'super-admin') && c.status === 'Pending' && (
                    <button type="button" onClick={() => payout(c.id)} className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer">
                      Approve Payout
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.commissions.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                  No agent commission entries recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SupportSection({ user, token, data, refresh, notify }: ViewProps) {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<'Connectivity' | 'DaliPay Payment' | 'Voucher Issue' | 'Router Hardware'>('Connectivity');
  const [priority, setPriority] = useState<'Normal' | 'High' | 'Urgent'>('Normal');
  const [message, setMessage] = useState('');

  const createTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/tickets', {
      method: 'POST',
      token,
      body: { subject, category, priority, message, siteName: data.sites[0]?.name },
    });
    setSubject('');
    setMessage('');
    await refresh();
    notify('Support ticket logged.');
  };

  const resolveTicket = async (id: string) => {
    await apiRequest(`/api/tickets/${id}`, {
      method: 'PATCH',
      token,
      body: { status: 'Resolved', reply: 'Verified by NOC Support Engineer; service confirmed operational.' },
    });
    await refresh();
    notify(`Ticket ${id} marked Resolved.`);
  };

  return (
    <div className="space-y-6">
      <form onSubmit={createTicket} className="border border-slate-200 bg-white rounded-lg p-5 space-y-3">
        <h3 className="font-display text-sm font-bold text-slate-900">Open Support Ticket</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Issue summary..." className="px-3 py-2 text-xs border border-slate-300 rounded-md" />
          <select value={category} onChange={(e) => setCategory(e.target.value as 'Connectivity' | 'DaliPay Payment' | 'Voucher Issue' | 'Router Hardware')} className="px-3 py-2 text-xs border border-slate-300 rounded-md bg-white">
            <option value="Connectivity">Connectivity</option>
            <option value="DaliPay Payment">DaliPay Payment</option>
            <option value="Voucher Issue">Voucher Issue</option>
            <option value="Router Hardware">Router Hardware</option>
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as 'Normal' | 'High' | 'Urgent')} className="px-3 py-2 text-xs border border-slate-300 rounded-md bg-white">
            <option value="Normal">Normal</option>
            <option value="High">High</option>
            <option value="Urgent">Urgent</option>
          </select>
        </div>
        <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Additional diagnostic details (MAC address, DaliPay reference)..." className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md" />
        <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer">
          Submit Ticket
        </button>
      </form>

      <div className="border border-slate-200 bg-white rounded-lg divide-y divide-slate-200">
        {data.tickets.map((t) => (
          <div key={t.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-mono font-semibold text-slate-700">{t.id}</span>
                <span aria-hidden="true">·</span>
                <span>{t.category}</span>
                <span aria-hidden="true">·</span>
                <span>{t.siteName}</span>
                <span aria-hidden="true">·</span>
                <StatusText status={t.status} />
              </div>
              <div className="font-semibold text-sm text-slate-900">{t.subject}</div>
              <div className="text-xs text-slate-600">{t.lastReply}</div>
            </div>
            {['super-admin', 'admin', 'support'].includes(user.role) && t.status !== 'Resolved' && (
              <button
                type="button"
                onClick={() => resolveTicket(t.id)}
                className="px-3.5 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-300 rounded-md hover:bg-emerald-50 cursor-pointer shrink-0 self-start md:self-center"
              >
                Resolve Ticket
              </button>
            )}
          </div>
        ))}
        {data.tickets.length === 0 && (
          <div className="p-8 text-center text-xs text-slate-500">
            No support tickets have been opened yet.
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkersAndAuditSection({ user, token, data, refresh, notify }: ViewProps) {
  const [running, setRunning] = useState(false);

  const triggerWorkers = async () => {
    setRunning(true);
    try {
      await apiRequest('/api/worker/run', { method: 'POST', token, body: { jobKey: 'all' } });
      await refresh();
      notify('Executed full background worker accounting & expiration sweep.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Background Worker Jobs</h3>
            <p className="text-xs text-slate-500">Automated payment reconciliation, voucher expiration, and RADIUS CoA enforcement</p>
          </div>
          {(user.role === 'super-admin' || user.role === 'admin') && (
            <button
              type="button"
              disabled={running}
              onClick={triggerWorkers}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{running ? 'Running Sweep...' : 'Run Worker Sweep'}</span>
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {data.workerJobs.map((job) => (
            <div key={job.key} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">{job.name}</div>
                <div className="text-xs text-slate-600">{job.summary}</div>
              </div>
              <div className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
                Processed: {job.processedCount} · {new Date(job.lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-slate-200 bg-white rounded-lg overflow-x-auto">
        <div className="px-5 py-3 border-b border-slate-200 text-xs font-bold text-slate-900">Audit Trail</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
            <tr>
              <th className="py-2.5 px-4">Time</th>
              <th className="py-2.5 px-4">Actor</th>
              <th className="py-2.5 px-4">Action</th>
              <th className="py-2.5 px-4">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.auditLogs.slice(0, 20).map((log) => (
              <tr key={log.id}>
                <td className="py-2 px-4 font-mono text-slate-500 tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </td>
                <td className="py-2 px-4 font-medium text-slate-900">{log.actorName}</td>
                <td className="py-2 px-4 text-slate-700">{log.action}</td>
                <td className="py-2 px-4 font-mono text-slate-600">{log.target}</td>
              </tr>
            ))}
            {data.auditLogs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-xs text-slate-500">
                  No audit events recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TopologySection({
  user,
  token,
  data,
  refresh,
  notify,
  onAddRouter,
}: ViewProps & { onAddRouter?: () => void }) {
  return (
    <RouterTopologyMap
      user={user}
      token={token}
      routers={data.routers}
      sites={data.sites}
      organizations={data.organizations}
      sessions={data.sessions}
      refresh={refresh}
      notify={notify}
      onAddRouter={onAddRouter}
    />
  );
}

export function AlertsSection({ user, token, data, refresh, notify }: ViewProps) {
  return (
    <RouterAlertsPanel
      user={user}
      token={token}
      organizations={data.organizations}
      routers={data.routers}
      refresh={refresh}
      notify={notify}
    />
  );
}


