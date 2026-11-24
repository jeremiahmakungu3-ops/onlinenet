import React, { useEffect, useState } from 'react';
import { Check, Copy, Landmark, ShieldCheck } from 'lucide-react';
import type { Organization, PaymentGatewayConfig, PublicUser } from '../../../packages/shared/types';
import { apiRequest } from '../../services/api';
import { StatusText } from '../ui/StatusText';

interface PaymentGatewaysPanelProps {
  user: PublicUser;
  token: string;
  gateways: PaymentGatewayConfig[];
  organizations: Organization[];
  refresh: () => Promise<void>;
  notify: (msg: string) => void;
}

interface GatewayDraft {
  enabled: boolean;
  merchantShortcode: string;
  accountName: string;
}

export function PaymentGatewaysPanel({
  user,
  token,
  gateways: initialGateways,
  organizations,
  refresh,
  notify,
}: PaymentGatewaysPanelProps) {
  const [selectedOrgId, setSelectedOrgId] = useState(user.organizationId);
  const [gateways, setGateways] = useState<PaymentGatewayConfig[]>(initialGateways);
  const [drafts, setDrafts] = useState<Record<string, GatewayDraft>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (selectedOrgId === user.organizationId) {
      setGateways(initialGateways);
    }
  }, [initialGateways, selectedOrgId, user.organizationId]);

  useEffect(() => {
    const nextDrafts: Record<string, GatewayDraft> = {};
    for (const gw of gateways) {
      nextDrafts[gw.code] = {
        enabled: gw.enabled,
        merchantShortcode: gw.merchantShortcode || '',
        accountName: gw.accountName || '',
      };
    }
    setDrafts(nextDrafts);
  }, [gateways]);

  const handleOrgChange = async (orgId: string) => {
    setSelectedOrgId(orgId);
    setError('');
    try {
      const res = await apiRequest<{ organizationId: string; gateways: PaymentGatewayConfig[] }>(
        `/api/gateways?organizationId=${encodeURIComponent(orgId)}`,
        { token }
      );
      setGateways(res.gateways);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load organization payment gateways.');
    }
  };

  const updateDraft = (code: string, patch: Partial<GatewayDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [code]: {
        enabled: prev[code]?.enabled ?? false,
        merchantShortcode: prev[code]?.merchantShortcode ?? '',
        accountName: prev[code]?.accountName ?? '',
        ...patch,
      },
    }));
  };

  const saveGateway = async (e: React.FormEvent, gw: PaymentGatewayConfig) => {
    e.preventDefault();
    const draft = drafts[gw.code];
    if (!draft) return;

    setSavingCode(gw.code);
    setError('');
    try {
      const res = await apiRequest<{ gateway: PaymentGatewayConfig }>(`/api/gateways/${gw.code}`, {
        method: 'PATCH',
        token,
        body: {
          organizationId: selectedOrgId,
          enabled: draft.enabled,
          merchantShortcode: draft.merchantShortcode,
          accountName: draft.accountName,
        },
      });

      setGateways((prev) => prev.map((item) => (item.code === gw.code ? res.gateway : item)));
      if (selectedOrgId === user.organizationId) {
        await refresh();
      }
      notify(
        `${gw.name} saved (${res.gateway.enabled ? 'Enabled on Captive Portal' : 'Paused'}).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to update ${gw.name}.`);
    } finally {
      setSavingCode(null);
    }
  };

  const copyWebhookUrl = (code: string, path: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = `${origin}${path}`;
    navigator.clipboard?.writeText(fullUrl).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  };

  const enabledCount = gateways.filter((g) => g.enabled).length;
  const readyCount = gateways.filter((g) => g.credentialsConfigured).length;

  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <div className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Landmark className="w-4 h-4 text-blue-700" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Tanzania Payment Gateways &amp; Mobile Money Channels
              </h2>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">
              Configure merchant paybill / Lipa Namba routing and captive portal availability. API keys and webhook HMAC secrets are injected exclusively via server environment variables for security.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 shrink-0">
            <div className="text-right">
              <div className="text-[11px] font-medium text-slate-500">Portal Enabled</div>
              <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                {enabledCount} / {gateways.length}
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200" aria-hidden="true" />
            <div className="text-right">
              <div className="text-[11px] font-medium text-slate-500">Server Keys Ready</div>
              <div className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                {readyCount} / {gateways.length}
              </div>
            </div>
          </div>
        </div>

        {user.role === 'super-admin' && organizations.length > 1 && (
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
            <label htmlFor="gateway-org-select" className="text-xs font-semibold text-slate-700">
              Tenant Organization Scope:
            </label>
            <select
              id="gateway-org-select"
              value={selectedOrgId}
              onChange={(e) => handleOrgChange(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white max-w-xs"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.plan})
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Gateway Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {gateways.map((gw) => {
          const draft = drafts[gw.code] || {
            enabled: gw.enabled,
            merchantShortcode: gw.merchantShortcode || '',
            accountName: gw.accountName || '',
          };
          const statusLabel = gw.enabled
            ? gw.credentialsConfigured
              ? 'Active'
              : 'Pending'
            : 'Paused';
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const webhookUrl = `${origin}${gw.webhookPath}`;

          return (
            <form
              key={gw.code}
              onSubmit={(e) => saveGateway(e, gw)}
              className="border border-slate-200 bg-white rounded-lg p-5 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-sm font-bold text-slate-900">{gw.name}</h3>
                      <span className="font-mono text-[11px] text-slate-400">{gw.code}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {gw.channels.join(' · ')}
                    </p>
                  </div>
                  <StatusText status={statusLabel} />
                </div>

                {/* Server Environment Readiness */}
                <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
                      <span>Server Environment Credentials</span>
                    </span>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        gw.credentialsConfigured ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {gw.credentialsConfigured ? 'Configured' : 'Awaiting Env Secrets'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">Webhook HMAC Verification</span>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        gw.webhookSecretConfigured ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {gw.webhookSecretConfigured ? 'Configured' : 'Awaiting Webhook Secret'}
                    </span>
                  </div>

                  <div className="pt-1 border-t border-slate-200/70">
                    <div className="text-[11px] text-slate-500 mb-1">Required Server Secrets</div>
                    <div className="font-mono text-[11px] text-slate-700 break-all">
                      {gw.requiredEnvVars.join(' · ')}
                    </div>
                  </div>

                  <div className="pt-1 border-t border-slate-200/70 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-500">Webhook Callback Endpoint</div>
                      <div className="font-mono text-[11px] text-slate-800 truncate">{webhookUrl}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyWebhookUrl(gw.code, gw.webhookPath)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 cursor-pointer shrink-0"
                    >
                      {copiedCode === gw.code ? (
                        <Check className="w-3 h-3 text-emerald-700" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedCode === gw.code ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {/* Non-Secret Merchant Routing Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Merchant Shortcode / Lipa Namba
                    </label>
                    <input
                      type="text"
                      value={draft.merchantShortcode}
                      onChange={(e) => updateDraft(gw.code, { merchantShortcode: e.target.value })}
                      placeholder="e.g. 556677 or 001122"
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Merchant Account Name
                    </label>
                    <input
                      type="text"
                      value={draft.accountName}
                      onChange={(e) => updateDraft(gw.code, { accountName: e.target.value })}
                      placeholder="e.g. XCLOUD HOTSPOT TZ"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => updateDraft(gw.code, { enabled: e.target.checked })}
                    className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                  />
                  <span>Enable on Captive Portal</span>
                </label>

                <button
                  type="submit"
                  disabled={savingCode === gw.code}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer"
                >
                  {savingCode === gw.code ? 'Saving...' : 'Save Gateway'}
                </button>
              </div>
            </form>
          );
        })}
      </div>
    </div>
  );
}
