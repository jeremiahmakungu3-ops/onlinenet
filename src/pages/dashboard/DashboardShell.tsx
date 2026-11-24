import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Building2,
  CreditCard,
  Headphones,
  Landmark,
  Layers,
  LayoutDashboard,
  LogOut,
  Network,
  Router as RouterIcon,
  ServerCog,
  Ticket,
  Users,
  Wifi,
} from 'lucide-react';
import type {
  AgentRecord,
  AuditLogEntry,
  CommissionEntry,
  HotspotPackage,
  Organization,
  PaymentGatewayConfig,
  PaymentTransaction,
  RadiusSession,
  RouterDevice,
  Site,
  SupportTicket,
  UserRole,
  Voucher,
  WorkerJobState,
} from '../../../packages/shared/types';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../services/api';
import { DashboardSkeleton } from '../../components/dashboard/DashboardSkeleton';
import {
  AgentsSection,
  AlertsSection,
  GatewaysSection,
  OrganizationsSection,
  OverviewSection,
  PackagesSection,
  PaymentsSection,
  SessionsSection,
  SitesAndRoutersSection,
  SupportSection,
  TopologySection,
  VouchersSection,
  WorkersAndAuditSection,
  type DashboardBundle,
} from './DashboardViews';

interface NavTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ROLE_TABS: Record<UserRole, NavTab[]> = {
  'super-admin': [
    { id: 'overview', label: 'Platform Overview', icon: LayoutDashboard },
    { id: 'organizations', label: 'Tenants & Orgs', icon: Building2 },
    { id: 'routers', label: 'Sites & Routers', icon: RouterIcon },
    { id: 'topology', label: 'Topology Map', icon: Network },
    { id: 'alerts', label: 'Router Alerts', icon: Bell },
    { id: 'packages', label: 'Hotspot Packages', icon: Layers },
    { id: 'vouchers', label: 'Voucher Batches', icon: Ticket },
    { id: 'sessions', label: 'RADIUS Sessions', icon: Activity },
    { id: 'payments', label: 'Payment Ledger', icon: CreditCard },
    { id: 'gateways', label: 'Payment Gateways', icon: Landmark },
    { id: 'agents', label: 'Agents & Payouts', icon: Users },
    { id: 'support', label: 'Support Queue', icon: Headphones },
    { id: 'workers', label: 'Workers & Audit', icon: ServerCog },
  ],
  admin: [
    { id: 'overview', label: 'ISP Overview', icon: LayoutDashboard },
    { id: 'routers', label: 'Sites & Routers', icon: RouterIcon },
    { id: 'topology', label: 'Topology Map', icon: Network },
    { id: 'alerts', label: 'Router Alerts', icon: Bell },
    { id: 'packages', label: 'Hotspot Packages', icon: Layers },
    { id: 'vouchers', label: 'Voucher Generator', icon: Ticket },
    { id: 'sessions', label: 'Live RADIUS', icon: Activity },
    { id: 'payments', label: 'Payment Orders', icon: CreditCard },
    { id: 'gateways', label: 'Payment Gateways', icon: Landmark },
    { id: 'agents', label: 'Agents & Commissions', icon: Users },
    { id: 'support', label: 'Support Tickets', icon: Headphones },
    { id: 'workers', label: 'Workers & Audit', icon: ServerCog },
  ],
  agent: [
    { id: 'overview', label: 'Agent Overview', icon: LayoutDashboard },
    { id: 'vouchers', label: 'Sell & Issue Vouchers', icon: Ticket },
    { id: 'agents', label: 'My Commissions', icon: Users },
    { id: 'payments', label: 'Sales Receipts', icon: CreditCard },
    { id: 'support', label: 'Raise Ticket', icon: Headphones },
  ],
  support: [
    { id: 'overview', label: 'NOC Overview', icon: LayoutDashboard },
    { id: 'support', label: 'Ticket Queue', icon: Headphones },
    { id: 'routers', label: 'Router Diagnostics', icon: RouterIcon },
    { id: 'topology', label: 'Topology Map', icon: Network },
    { id: 'alerts', label: 'Router Alerts', icon: Bell },
    { id: 'sessions', label: 'Active Sessions', icon: Activity },
    { id: 'workers', label: 'Worker Logs', icon: ServerCog },
  ],
  customer: [
    { id: 'overview', label: 'My WiFi Overview', icon: LayoutDashboard },
    { id: 'sessions', label: 'Active Connection', icon: Wifi },
    { id: 'vouchers', label: 'My Vouchers', icon: Ticket },
    { id: 'payments', label: 'Payment Receipts', icon: CreditCard },
    { id: 'support', label: 'Help & Support', icon: Headphones },
  ],
};

const ROLE_TITLES: Record<UserRole, string> = {
  'super-admin': 'Super Admin Console',
  admin: 'ISP Operator Portal',
  agent: 'Reseller Agent Portal',
  support: 'NOC Support Console',
  customer: 'Subscriber WiFi Portal',
};

export function DashboardShell() {
  const { user, token, logout, navigate } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [data, setData] = useState<DashboardBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState('');

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!token || !user) return;
    const isAdminOrSuper = user.role === 'super-admin' || user.role === 'admin';
    const canSeeAgents = isAdminOrSuper || user.role === 'agent';
    const canSeeAudit = isAdminOrSuper || user.role === 'support';

    const [
      overviewRes,
      orgsRes,
      sitesRes,
      routersRes,
      packagesRes,
      vouchersRes,
      sessionsRes,
      paymentsRes,
      gatewaysRes,
      agentsRes,
      ticketsRes,
      auditRes,
      workerRes,
    ] = await Promise.all([
      apiRequest<DashboardBundle['overview']>('/api/overview', { token }),
      user.role === 'super-admin'
        ? apiRequest<{ organizations: Organization[] }>('/api/organizations', { token })
        : Promise.resolve({ organizations: [] }),
      apiRequest<{ sites: Site[] }>('/api/sites', { token }),
      apiRequest<{ routers: RouterDevice[] }>('/api/routers', { token }),
      apiRequest<{ packages: HotspotPackage[] }>('/api/packages', { token }),
      apiRequest<{ vouchers: Voucher[] }>('/api/vouchers', { token }),
      apiRequest<{ sessions: RadiusSession[] }>('/api/sessions', { token }),
      apiRequest<{ payments: PaymentTransaction[] }>('/api/payments', { token }),
      isAdminOrSuper
        ? apiRequest<{ gateways: PaymentGatewayConfig[] }>('/api/gateways', { token })
        : Promise.resolve({ gateways: [] }),
      canSeeAgents
        ? apiRequest<{ agents: AgentRecord[]; commissions: CommissionEntry[] }>('/api/agents', { token })
        : Promise.resolve({ agents: [], commissions: [] }),
      apiRequest<{ tickets: SupportTicket[] }>('/api/tickets', { token }),
      canSeeAudit
        ? apiRequest<{ auditLogs: AuditLogEntry[] }>('/api/audit-logs', { token })
        : Promise.resolve({ auditLogs: [] }),
      canSeeAudit
        ? apiRequest<{ jobs: WorkerJobState[] }>('/api/worker/status', { token })
        : Promise.resolve({ jobs: [] }),
    ]);

    setData({
      overview: overviewRes,
      organizations: orgsRes.organizations,
      sites: sitesRes.sites,
      routers: routersRes.routers,
      packages: packagesRes.packages,
      vouchers: vouchersRes.vouchers,
      sessions: sessionsRes.sessions,
      payments: paymentsRes.payments,
      gateways: gatewaysRes.gateways,
      agents: agentsRes.agents,
      commissions: agentsRes.commissions,
      tickets: ticketsRes.tickets,
      auditLogs: auditRes.auditLogs,
      workerJobs: workerRes.jobs,
    });
  }, [token, user]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      await fetchAll();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load portal data.');
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }
    loadInitialData();
  }, [loadInitialData, navigate, token, user]);

  if (!user || !token) return null;

  const tabs = ROLE_TABS[user.role];
  const currentTabObj = tabs.find((t) => t.id === activeTab) || tabs[0];

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-[#0F172A]">
      {/* 260px Sidebar */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white hidden md:flex flex-col justify-between">
        <div>
          <div className="h-16 px-6 flex items-center border-b border-slate-200">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="font-display text-lg font-bold tracking-tight text-slate-900 cursor-pointer whitespace-nowrap"
            >
              XCLOUD.NET
            </button>
          </div>
          <div className="px-4 py-4">
            <div className="px-2 pb-2 text-xs font-semibold text-slate-400">
              {ROLE_TITLES[user.role]}
            </div>
            <nav className="space-y-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = currentTabObj.id === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="text-xs">
            <div className="font-semibold text-slate-900 truncate">{user.name}</div>
            <div className="text-slate-500 truncate">{user.organizationName}</div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-6 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
            <span className="font-semibold text-slate-900">{ROLE_TITLES[user.role]}</span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-700 font-medium">{currentTabObj.label}</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/captive-portal')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap shrink-0"
            >
              Open Captive Portal
            </button>
            <button
              type="button"
              onClick={logout}
              className="md:hidden px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </header>

        {/* Mobile Tab Strip */}
        <div className="md:hidden px-4 py-2 border-b border-slate-200 bg-white overflow-x-auto flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 ${
                currentTabObj.id === tab.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {toast && (
            <div className="mb-4 px-4 py-2.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
              {toast}
            </div>
          )}

          {loading ? (
            <DashboardSkeleton role={user.role} activeTab={currentTabObj.id} />
          ) : !data ? (
            <div className="border border-red-200 bg-white rounded-lg p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-900">Unable to load portal telemetry</p>
              <p className="text-xs text-slate-600">{loadError || 'Connection to the XCLOUD.NET API timed out.'}</p>
              <button
                type="button"
                onClick={loadInitialData}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
              >
                Retry Loading Portal
              </button>
            </div>
          ) : (
            <>
              {currentTabObj.id === 'overview' && <OverviewSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'organizations' && <OrganizationsSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'routers' && <SitesAndRoutersSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'topology' && (
                <TopologySection
                  user={user}
                  token={token}
                  data={data}
                  refresh={fetchAll}
                  notify={notify}
                  onAddRouter={() => setActiveTab('routers')}
                />
              )}
              {currentTabObj.id === 'alerts' && <AlertsSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'packages' && <PackagesSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'vouchers' && <VouchersSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'sessions' && <SessionsSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'payments' && <PaymentsSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'gateways' && <GatewaysSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'agents' && <AgentsSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'support' && <SupportSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
              {currentTabObj.id === 'workers' && <WorkersAndAuditSection user={user} token={token} data={data} refresh={fetchAll} notify={notify} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
