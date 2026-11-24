import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Mail, Plus, RefreshCw, Search, Send, Trash2 } from 'lucide-react';
import type {
  AlertEmailLog,
  EmailTransportStatus,
  Organization,
  PublicUser,
  RouterAlertSetting,
  RouterDevice,
} from '../../../packages/shared/types';
import { apiRequest } from '../../services/api';
import { StatusText } from '../ui/StatusText';

interface RouterAlertsPanelProps {
  user: PublicUser;
  token: string;
  organizations: Organization[];
  routers: RouterDevice[];
  refresh: () => Promise<void>;
  notify: (msg: string) => void;
}

interface AlertsConfigResponse {
  organizationId: string;
  setting: RouterAlertSetting;
  defaultRecipients: string[];
  transport: EmailTransportStatus;
  logs: AlertEmailLog[];
}

function triggerLabel(trigger: AlertEmailLog['triggerType']): string {
  if (trigger === 'router_offline') return 'Router Offline';
  if (trigger === 'router_critical_error') return 'Critical Error';
  return 'Recovered';
}

export function RouterAlertsPanel({
  user,
  token,
  organizations,
  routers,
  refresh,
  notify,
}: RouterAlertsPanelProps) {
  const [selectedOrgId, setSelectedOrgId] = useState(user.organizationId);
  const [setting, setSetting] = useState<RouterAlertSetting | null>(null);
  const [defaultRecipients, setDefaultRecipients] = useState<string[]>([]);
  const [transport, setTransport] = useState<EmailTransportStatus | null>(null);
  const [logs, setLogs] = useState<AlertEmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [error, setError] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [testRouterId, setTestRouterId] = useState('');
  const [testTrigger, setTestTrigger] = useState<'router_offline' | 'router_critical_error'>('router_offline');
  const [logFilter, setLogFilter] = useState<'all' | 'router_offline' | 'router_critical_error' | 'router_recovered'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const canEdit = user.role === 'super-admin' || user.role === 'admin';

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';
      const res = await apiRequest<AlertsConfigResponse>(`/api/alerts/config${qs}`, { token });
      setSetting(res.setting);
      setDefaultRecipients(res.defaultRecipients);
      setTransport(res.transport);
      setLogs(res.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load router alert settings.');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, token]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const orgRouters = useMemo(() => {
    if (user.role === 'super-admin' && selectedOrgId) {
      const filtered = routers.filter((r) => r.organizationId === selectedOrgId);
      return filtered.length > 0 ? filtered : routers;
    }
    return routers;
  }, [routers, selectedOrgId, user.role]);

  const effectiveTestRouterId = testRouterId && orgRouters.some((r) => r.id === testRouterId)
    ? testRouterId
    : orgRouters[0]?.id || '';

  const addRecipient = () => {
    if (!setting) return;
    const clean = newEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setError('Enter a valid administrator email address.');
      return;
    }
    setError('');
    if (!setting.recipientEmails.includes(clean)) {
      setSetting({ ...setting, recipientEmails: [...setting.recipientEmails, clean] });
    }
    setNewEmail('');
  };

  const removeRecipient = (email: string) => {
    if (!setting) return;
    setSetting({
      ...setting,
      recipientEmails: setting.recipientEmails.filter((e) => e !== email),
    });
  };

  const applyDefaultAdmins = () => {
    if (!setting) return;
    const merged = Array.from(new Set([...setting.recipientEmails, ...defaultRecipients]));
    setSetting({ ...setting, recipientEmails: merged });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setting) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiRequest<{
        setting: RouterAlertSetting;
        defaultRecipients: string[];
        transport: EmailTransportStatus;
      }>('/api/alerts/config', {
        method: 'PATCH',
        token,
        body: {
          organizationId: selectedOrgId,
          enabled: setting.enabled,
          recipientEmails: setting.recipientEmails,
          notifyOnOffline: setting.notifyOnOffline,
          notifyOnCriticalError: setting.notifyOnCriticalError,
          notifyOnRecovery: setting.notifyOnRecovery,
          cpuCriticalThreshold: setting.cpuCriticalThreshold,
          memoryCriticalThreshold: setting.memoryCriticalThreshold,
          cooldownMinutes: setting.cooldownMinutes,
        },
      });
      setSetting(res.setting);
      setDefaultRecipients(res.defaultRecipients);
      setTransport(res.transport);
      notify('Router email alert policy saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save router alert policy.');
    } finally {
      setSaving(false);
    }
  };

  const handleProbeAll = async () => {
    setProbing(true);
    setError('');
    try {
      await apiRequest('/api/routers/sync-all', { method: 'POST', token });
      await Promise.all([refresh(), loadConfig()]);
      notify('Probed all registered MikroTik & Omada routers and evaluated alert rules.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to probe routers.');
    } finally {
      setProbing(false);
    }
  };

  const handleSendTest = async () => {
    if (!effectiveTestRouterId) {
      setError('Register at least one MikroTik or Omada router before sending a test alert.');
      return;
    }
    setSendingTest(true);
    setError('');
    try {
      const res = await apiRequest<{ log: AlertEmailLog; transport: EmailTransportStatus }>('/api/alerts/test', {
        method: 'POST',
        token,
        body: {
          routerId: effectiveTestRouterId,
          organizationId: selectedOrgId,
          triggerType: testTrigger,
        },
      });
      setTransport(res.transport);
      await loadConfig();
      if (res.log.deliveryStatus === 'Sent') {
        notify(`Test alert email sent to ${res.log.recipients.join(', ')}.`);
      } else {
        notify(`Alert logged (${res.log.deliveryStatus}): ${res.log.errorDetail || 'Configure SMTP or Resend to deliver emails.'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch test alert.');
    } finally {
      setSendingTest(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((l) => {
      if (logFilter !== 'all' && l.triggerType !== logFilter) return false;
      if (q) {
        return (
          l.routerName.toLowerCase().includes(q) ||
          l.siteName.toLowerCase().includes(q) ||
          l.summary.toLowerCase().includes(q) ||
          l.recipients.some((r) => r.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [logFilter, logs, searchQuery]);

  if (loading && !setting) {
    return (
      <div className="border border-slate-200 bg-white rounded-lg p-6 text-xs text-slate-500">
        Loading router alert policy and delivery logs...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Transport Readiness & Live Probe Header */}
      <div className="border border-slate-200 bg-white rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="font-display text-base font-bold text-slate-900">
              Automated Router Offline &amp; Critical Error Alerts
            </h2>
            {transport && (
              <StatusText status={transport.configured ? 'Sent' : 'Skipped'} />
            )}
          </div>
          <p className="text-xs text-slate-600">
            {transport?.configured ? (
              <>
                Outbound email via <span className="font-mono font-semibold text-slate-800">{transport.provider}</span>
                {transport.smtpHost ? (
                  <>
                    {' '}· <span className="font-mono">{transport.smtpHost}:{transport.smtpPort}</span>
                  </>
                ) : null}
                {' '}· Sender <span className="font-mono">{transport.fromEmail}</span> · Background monitor runs every 60s.
              </>
            ) : (
              <>
                Email transport is currently unconfigured on the server. Configure{' '}
                <span className="font-mono text-slate-800">SMTP_HOST</span> /{' '}
                <span className="font-mono text-slate-800">SMTP_USER</span> /{' '}
                <span className="font-mono text-slate-800">SMTP_PASS</span> or{' '}
                <span className="font-mono text-slate-800">RESEND_API_KEY</span> in environment secrets to send outbound admin emails.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {user.role === 'super-admin' && organizations.length > 1 && (
            <select
              aria-label="Select tenant organization"
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={probing}
            onClick={handleProbeAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
            <span>{probing ? 'Probing Routers...' : 'Probe Routers Now'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Policy & Recipients + Diagnostic Test */}
      {setting && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSave}
            className="lg:col-span-8 border border-slate-200 bg-white rounded-lg p-5 space-y-5"
          >
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900">Alert Policy &amp; Admin Recipients</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Triggered automatically when a registered MikroTik or Omada router goes offline or reports a critical fault
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={setting.enabled}
                  onChange={(e) => setSetting({ ...setting, enabled: e.target.checked })}
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                <span>Alerts Active</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-start gap-2.5 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50/70">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={setting.notifyOnOffline}
                  onChange={(e) => setSetting({ ...setting, notifyOnOffline: e.target.checked })}
                  className="mt-0.5 rounded border-slate-300 text-blue-700"
                />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Router Offline</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">WAN / WireGuard API port unreachable</div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50/70">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={setting.notifyOnCriticalError}
                  onChange={(e) => setSetting({ ...setting, notifyOnCriticalError: e.target.checked })}
                  className="mt-0.5 rounded border-slate-300 text-blue-700"
                />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Critical Error</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">API auth/TLS failure or CPU/RAM spike</div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50/70">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={setting.notifyOnRecovery}
                  onChange={(e) => setSetting({ ...setting, notifyOnRecovery: e.target.checked })}
                  className="mt-0.5 rounded border-slate-300 text-blue-700"
                />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Recovery Notice</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Email when device returns Online</div>
                </div>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">CPU Critical Threshold (%)</label>
                <input
                  type="number"
                  min={50}
                  max={100}
                  disabled={!canEdit}
                  value={setting.cpuCriticalThreshold}
                  onChange={(e) => setSetting({ ...setting, cpuCriticalThreshold: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Memory Critical Threshold (%)</label>
                <input
                  type="number"
                  min={50}
                  max={100}
                  disabled={!canEdit}
                  value={setting.memoryCriticalThreshold}
                  onChange={(e) => setSetting({ ...setting, memoryCriticalThreshold: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Alert Cooldown (Minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  disabled={!canEdit}
                  value={setting.cooldownMinutes}
                  onChange={(e) => setSetting({ ...setting, cooldownMinutes: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700">
                  Administrator Email Recipients ({setting.recipientEmails.length})
                </label>
                {canEdit && defaultRecipients.length > 0 && (
                  <button
                    type="button"
                    onClick={applyDefaultAdmins}
                    className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    Load Registered Admins ({defaultRecipients.length})
                  </button>
                )}
              </div>

              {canEdit && (
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addRecipient();
                      }
                    }}
                    placeholder="noc-admin@isp.co.tz"
                    className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={addRecipient}
                    className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              )}

              <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
                {setting.recipientEmails.map((email) => (
                  <div key={email} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 font-mono text-slate-800 truncate">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{email}</span>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeRecipient(email)}
                        aria-label={`Remove ${email}`}
                        className="text-slate-400 hover:text-red-700 p-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {setting.recipientEmails.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-500">
                    No explicit recipients set — alerts will fall back to registered tenant admin emails ({defaultRecipients.join(', ') || 'none'}).
                  </div>
                )}
              </div>
            </div>

            {canEdit && (
              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer"
                >
                  {saving ? 'Saving Policy...' : 'Save Alert Policy'}
                </button>
              </div>
            )}
          </form>

          {/* Diagnostic Test Dispatch */}
          <div className="lg:col-span-4 border border-slate-200 bg-white rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-700" />
              <h3 className="font-display text-sm font-bold text-slate-900">Send Test Alert Email</h3>
            </div>
            <p className="text-xs text-slate-600">
              Verify end-to-end email delivery to your configured administrators using any registered MikroTik or Omada device.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Target Router</label>
              <select
                value={effectiveTestRouterId}
                onChange={(e) => setTestRouterId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
              >
                {orgRouters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.vendor} · {r.siteName})
                  </option>
                ))}
                {orgRouters.length === 0 && <option value="">No registered routers</option>}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Simulated Condition</label>
              <select
                value={testTrigger}
                onChange={(e) => setTestTrigger(e.target.value as 'router_offline' | 'router_critical_error')}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="router_offline">Router Offline (Unreachable)</option>
                <option value="router_critical_error">Critical Error (Hardware / API Fault)</option>
              </select>
            </div>

            <button
              type="button"
              disabled={sendingTest || orgRouters.length === 0}
              onClick={handleSendTest}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{sendingTest ? 'Dispatching Email...' : 'Send Test Alert'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Alert Delivery History Table */}
      <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">Alert Incident &amp; Email Delivery Log</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every offline, critical error, and recovery notification dispatched for registered MikroTik &amp; Omada devices
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'router_offline', label: 'Offline' },
                  { id: 'router_critical_error', label: 'Critical Error' },
                  { id: 'router_recovered', label: 'Recovered' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLogFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer transition-colors ${
                    logFilter === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter router, recipient, or error..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Router · Site</th>
                <th className="py-2.5 px-4">Trigger · Severity</th>
                <th className="py-2.5 px-4">Recipients</th>
                <th className="py-2.5 px-4">Summary</th>
                <th className="py-2.5 px-4">Email Delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-mono text-xs font-semibold text-slate-900">{log.routerName}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {log.vendor} · {log.siteName}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="text-xs font-semibold text-slate-800">{triggerLabel(log.triggerType)}</div>
                    <div className="mt-0.5">
                      <StatusText status={log.severity} />
                    </div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-700">
                    {log.recipients.length > 0 ? log.recipients.join(', ') : '—'}
                  </td>
                  <td className="py-2.5 px-4 max-w-md">
                    <div className="text-xs text-slate-800">{log.summary}</div>
                    {log.errorDetail && (
                      <div className="font-mono text-[11px] text-slate-500 mt-0.5 break-words">{log.errorDetail}</div>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <StatusText status={log.deliveryStatus} />
                    <div className="font-mono text-[11px] text-slate-500 mt-0.5">{log.provider}</div>
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                    No router offline or critical error alerts have been triggered yet.
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
