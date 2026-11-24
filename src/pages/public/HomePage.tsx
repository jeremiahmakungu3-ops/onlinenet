import React, { useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../services/api';
import { ResilientImage } from '../../components/ui/ResilientImage';

interface CatalogData {
  metrics: {
    activeHotspots: number;
    onlineRouters: number;
    activeSessions: number;
    totalVouchersIssued: number;
  };
}

export function HomePage() {
  const { navigate } = useAuth();
  const [metrics, setMetrics] = useState<CatalogData['metrics']>({
    activeHotspots: 0,
    onlineRouters: 0,
    activeSessions: 0,
    totalVouchersIssued: 0,
  });

  const [leadForm, setLeadForm] = useState({
    name: '',
    email: '',
    company: '',
    sitesCount: '1-5 sites',
    message: '',
  });
  const [leadStatus, setLeadStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');
  const [leadError, setLeadError] = useState('');

  useEffect(() => {
    apiRequest<CatalogData>('/api/public/catalog')
      .then((res) => setMetrics(res.metrics))
      .catch(() => {});
  }, []);

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeadError('');
    if (!leadForm.name.trim() || !leadForm.email.includes('@')) {
      setLeadError('Enter your name and a valid work email address.');
      return;
    }
    setLeadStatus('submitting');
    try {
      await apiRequest('/api/public/leads', { method: 'POST', body: leadForm });
      setLeadStatus('sent');
      setLeadForm({ name: '', email: '', company: '', sitesCount: '1-5 sites', message: '' });
    } catch (err) {
      setLeadStatus('error');
      setLeadError(err instanceof Error ? err.message : 'Unable to submit request.');
    }
  };

  return (
    <div>
      {/* 1. HERO SECTION */}
      <section className="max-w-7xl mx-auto px-6 pt-12 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between py-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-blue-700 mb-4">
                Multi-Tenant WiFi Hotspot Billing &amp; Network Automation
              </p>
              <h1
                className="font-display font-bold tracking-tight text-slate-900 text-balance leading-[1.08] mb-6"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.75rem)' }}
              >
                Automate hotspot billing from router to mobile money.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl mb-8">
                XCLOUD.NET connects MikroTik RouterOS and TP-Link Omada access points directly to FreeRADIUS accounting, cryptographic voucher batches, and instant DaliPay collections across every site you operate.
              </p>
              <div className="flex flex-wrap items-center gap-5">
                <button
                  type="button"
                  onClick={() => navigate('/captive-portal')}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Open Captive Portal</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="text-sm font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-4 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Operator Sign In
                </button>
              </div>
            </div>

            <div className="pt-8 mt-8 border-t border-slate-200 text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span>MikroTik RouterOS API</span>
              <span aria-hidden="true">·</span>
              <span>TP-Link Omada SDN</span>
              <span aria-hidden="true">·</span>
              <span>FreeRADIUS CoA</span>
              <span aria-hidden="true">·</span>
              <span>DaliPay Mobile Money</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[340px] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
              <ResilientImage
                src="/src/assets/images/hero_network_infrastructure_1795468969594.jpg"
                alt="XCLOUD.NET network operations center overlooking metropolitan wireless mesh infrastructure"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>

        {/* Full-Width 4-Column Live Telemetry Strip */}
        <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 border border-slate-200 bg-white rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          <div className="p-6">
            <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {metrics.totalVouchersIssued.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">Issued Vouchers Recorded</div>
          </div>
          <div className="p-6">
            <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {metrics.activeSessions.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">Active RADIUS Sessions</div>
          </div>
          <div className="p-6">
            <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {metrics.onlineRouters.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">Online NAS Routers</div>
          </div>
          <div className="p-6">
            <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {metrics.activeHotspots.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">Active Captive Hotspot Sites</div>
          </div>
        </div>
      </section>

      {/* 2. CAPABILITIES ASYMMETRIC BENTO */}
      <section className="border-t border-slate-200 bg-white py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-12">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance mb-3">
              Built for regional ISPs, transit terminals, and multi-site operators.
            </h2>
            <p className="text-base text-slate-600 leading-relaxed">
              Every router, reseller kiosk, and subscriber session shares a single source of truth without manual WinBox edits or spreadsheet reconciliation.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Marquee Card 01 */}
            <div className="lg:col-span-7 border border-slate-200 rounded-lg bg-[#F8FAFC] overflow-hidden flex flex-col justify-between">
              <div className="p-8">
                <h3 className="font-display text-xl font-semibold text-slate-900 mb-2">
                  01. MikroTik &amp; Omada Router Orchestration
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed max-w-xl">
                  Provision CCR, RB5009, and Omada OC300 controllers over encrypted WireGuard tunnels. Push bandwidth queues, inspect DHCP leases, and send RADIUS CoA disconnects in under two seconds.
                </p>
              </div>
              <div className="h-64 border-t border-slate-200 overflow-hidden">
                <ResilientImage
                  src="/src/assets/images/hardware_mikrotik_rack_1795468969651.jpg"
                  alt="Enterprise MikroTik router and TP-Link Omada access point hardware rack"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Card 02 */}
            <div className="lg:col-span-5 border border-slate-200 rounded-lg bg-white p-8 flex flex-col justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold text-slate-900 mb-2">
                  02. DaliPay Mobile Money Settlement
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">
                  Subscribers select a time or volume pass on the captive portal and approve an M-Pesa, Tigo Pesa, Airtel Money, or Halopesa prompt. HMAC-verified webhooks automatically generate and bind their WiFi session.
                </p>
              </div>
              <div className="border-t border-slate-200 pt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">STK / USSD Prompt Dispatch</span>
                  <span className="font-mono text-slate-900 tabular-nums">&lt; 1.2s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Webhook Signature Verification</span>
                  <span className="font-mono text-slate-900">HMAC-SHA256</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Idempotent Voucher Auto-Issue</span>
                  <span className="font-mono text-slate-900">Guaranteed</span>
                </div>
              </div>
            </div>

            {/* Card 03 */}
            <div className="lg:col-span-5 border border-slate-200 rounded-lg bg-white p-8 flex flex-col justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold text-slate-900 mb-2">
                  03. FreeRADIUS Accounting &amp; Worker Sweeps
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">
                  Background workers monitor interim accounting octets, expire elapsed vouchers, and terminate exhausted MAC leases automatically across every NAS.
                </p>
              </div>
              <div className="border-t border-slate-200 pt-5 space-y-2.5 text-sm text-slate-700">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>Automatic MAC-to-Voucher session binding</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>Per-package Mbps burst &amp; device limits</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>Real-time NOC CoA disconnect button</span>
                </div>
              </div>
            </div>

            {/* Card 04 */}
            <div className="lg:col-span-7 border border-slate-200 rounded-lg bg-[#F8FAFC] overflow-hidden grid grid-cols-1 md:grid-cols-2">
              <div className="p-8 flex flex-col justify-between">
                <div>
                  <h3 className="font-display text-xl font-semibold text-slate-900 mb-2">
                    04. Field Agent Kiosks &amp; Commission Ledgers
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Empower local kiosk vendors to issue cash vouchers from a dedicated Agent Portal while tracking per-voucher commission rates and one-click payouts.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/features')}
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800 cursor-pointer w-fit"
                >
                  <span>Inspect All Architecture Modules</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <div className="h-56 md:h-full border-t md:border-t-0 md:border-l border-slate-200 overflow-hidden">
                <ResilientImage
                  src="/src/assets/images/venue_cafe_hotspot_1795468971105.jpg"
                  alt="Busy transit cafe and coworking lounge connected via XCLOUD.NET WiFi"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. DEPLOYMENT ARCHITECTURES */}
      <section className="border-t border-slate-200 bg-[#F8FAFC] py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Production hotspot architectures across Tanzania
              </h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/pricing')}
              className="text-sm font-semibold text-blue-700 hover:text-blue-800 cursor-pointer whitespace-nowrap"
            >
              View Operator Plans &rarr;
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <article className="border border-slate-200 bg-white rounded-lg p-7">
              <div className="text-xs text-slate-500 mb-3">
                Transit Terminals &amp; Bus Hubs
              </div>
              <div className="font-mono text-xl font-bold text-slate-900 mb-2">
                M-Pesa &amp; Tigo Pesa Self-Checkout
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Travelers connect on MikroTik CCR hotspots, pay via mobile money USSD push, and receive instant MAC-bound FreeRADIUS authorization without waiting at a kiosk.
              </p>
            </article>

            <article className="border border-slate-200 bg-white rounded-lg p-7">
              <div className="text-xs text-slate-500 mb-3">
                Multi-Site WISP Operators
              </div>
              <div className="font-mono text-xl font-bold text-slate-900 mb-2">
                WireGuard + RouterOS Provisioning
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Centralize walled-garden rules, hotspot profiles, and live CoA session termination across distributed MikroTik RouterOS v7 and Omada OC300 controllers.
              </p>
            </article>

            <article className="border border-slate-200 bg-white rounded-lg p-7">
              <div className="text-xs text-slate-500 mb-3">
                Kiosk Resellers &amp; Hospitality
              </div>
              <div className="font-mono text-xl font-bold text-slate-900 mb-2">
                Printable A4 Voucher PDF Batches
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Generate batch voucher sheets with site SSIDs and TZS pricing for counter distribution while tracking reseller commission balances in real time.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* 4. PRICING SUMMARY */}
      <section className="border-t border-slate-200 bg-white py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-10">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance mb-2">
              Transparent operator licensing
            </h2>
            <p className="text-base text-slate-600">
              Start with a single MikroTik venue or manage dozens of multi-city ISP tenants across Tanzania under one Super Admin workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                audience: 'For single-venue cafes & lodges',
                name: 'Starter Site',
                price: 'TZS 120,000',
                cadence: '/ month',
                limits: ['Up to 5 Hotspot Sites', 'Up to 10 MikroTik / Omada Routers', 'Unlimited Voucher Batches', 'M-Pesa & Tigo Pesa Checkout'],
                featured: false,
              },
              {
                audience: 'For growing WISP & transit operators',
                name: 'Regional ISP',
                price: 'TZS 350,000',
                cadence: '/ month',
                limits: ['Up to 25 Hotspot Sites', 'Up to 50 Routers & WireGuard Tunnels', 'Reseller Agent Commission Portal', 'NOC Support & CoA Controls'],
                featured: true,
              },
              {
                audience: 'For multi-tenant telecom carriers',
                name: 'Carrier Multi-Tenant',
                price: 'TZS 890,000',
                cadence: '/ month',
                limits: ['Unlimited Organizations & Sites', '150+ Managed Routers & Controllers', 'Dedicated FreeRADIUS SQL Cluster', 'Custom Webhook & SLA Support'],
                featured: false,
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`rounded-lg p-7 border flex flex-col justify-between ${
                  tier.featured ? 'border-blue-700 bg-blue-50/30' : 'border-slate-200 bg-[#F8FAFC]'
                }`}
              >
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">{tier.audience}</div>
                  <h3 className="font-display text-xl font-bold text-slate-900 mb-4">{tier.name}</h3>
                  <div className="flex items-baseline gap-1.5 mb-6">
                    <span className="font-mono text-3xl font-bold text-slate-900 tabular-nums">{tier.price}</span>
                    <span className="text-xs text-slate-500">{tier.cadence}</span>
                  </div>
                  <ul className="space-y-2.5 text-sm text-slate-700 border-t border-slate-200 pt-5">
                    {tier.limits.map((line) => (
                      <li key={line} className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-blue-700 shrink-0" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => navigate('/register')}
                  className={`mt-8 w-full py-2.5 px-4 text-sm font-semibold rounded-md transition-colors cursor-pointer ${
                    tier.featured
                      ? 'bg-blue-700 text-white hover:bg-blue-800'
                      : 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Deploy {tier.name}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. LEAD CAPTURE */}
      <section className="border-t border-slate-200 bg-[#F8FAFC] py-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance mb-3">
              Schedule an infrastructure onboarding call
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              Share your current router fleet and target sites. Our network engineers provide a pre-configured WireGuard script and FreeRADIUS profile within one business day.
            </p>
            <div className="text-xs text-slate-500 space-y-1.5">
              <div>Direct Engineering Desk: noc@xcloud.net</div>
              <div>DaliPay Merchant Onboarding: settlements@xcloud.net</div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <form onSubmit={handleLeadSubmit} className="bg-white border border-slate-200 rounded-lg p-7 space-y-4">
              {leadStatus === 'sent' && (
                <div className="p-4 rounded-md bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                  Onboarding request received. Our NOC engineering team will contact you shortly.
                </div>
              )}
              {leadError && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                  {leadError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    required
                    value={leadForm.name}
                    onChange={(e) => setLeadForm((s) => ({ ...s, name: e.target.value }))}
                    placeholder="Full Name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Work Email</label>
                  <input
                    type="email"
                    required
                    value={leadForm.email}
                    onChange={(e) => setLeadForm((s) => ({ ...s, email: e.target.value }))}
                    placeholder="ops@yourisp.co.tz"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Company / ISP Name</label>
                  <input
                    type="text"
                    value={leadForm.company}
                    onChange={(e) => setLeadForm((s) => ({ ...s, company: e.target.value }))}
                    placeholder="Your ISP Ltd"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Planned Deployment Scale</label>
                  <select
                    value={leadForm.sitesCount}
                    onChange={(e) => setLeadForm((s) => ({ ...s, sitesCount: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                  >
                    <option value="1-5 sites">1 - 5 Hotspot Sites</option>
                    <option value="6-25 sites">6 - 25 Hotspot Sites</option>
                    <option value="25+ sites">25+ Multi-City Sites</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Hardware &amp; Payment Notes</label>
                <textarea
                  rows={3}
                  value={leadForm.message}
                  onChange={(e) => setLeadForm((s) => ({ ...s, message: e.target.value }))}
                  placeholder="MikroTik CCR2004, Omada OC300, M-Pesa / Tigo Pesa / Airtel Money collections..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              <button
                type="submit"
                disabled={leadStatus === 'submitting'}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
              >
                {leadStatus === 'submitting' ? 'Submitting Request...' : 'Request Onboarding Consultation'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
