import React, { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../services/api';
import { ResilientImage } from '../../components/ui/ResilientImage';

export function FeaturesPage() {
  const { navigate } = useAuth();
  const modules = [
    {
      title: '01. MikroTik & TP-Link Omada Connectors',
      detail:
        'Automated WireGuard tunnel provisioning, live CPU/RAM telemetry, DHCP lease inspection, and hotspot walled-garden synchronization.',
      specs: 'RouterOS API v7 · Omada OpenAPI · WireGuard Mesh',
    },
    {
      title: '02. FreeRADIUS SQL & CoA Engine',
      detail:
        'Sub-20ms Access-Request authorization with automated interim accounting updates and immediate CoA Disconnect-Request enforcement.',
      specs: 'radcheck · radacct · CoA Port 3799',
    },
    {
      title: '03. DaliPay Mobile Money Collections',
      detail:
        'Direct captive portal checkout for Vodacom M-Pesa, Tigo Pesa, Airtel Money, and Halopesa wallets with HMAC-SHA256 webhook verification and automatic voucher issuance.',
      specs: 'STK/USSD Push · Idempotent Settlement · Instant Receipt',
    },
    {
      title: '04. Multi-Tenant RBAC & Agent Commissions',
      detail:
        'Isolated organization scopes for Super Admins, ISP Operators, Reseller Agents, NOC Support Engineers, and WiFi Subscribers.',
      specs: '5 Role Consoles · Cryptographic Voucher Batches · Payout Ledger',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <div className="max-w-3xl mb-12">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 text-balance mb-4">
          End-to-end architecture from access point to settlement ledger
        </h1>
        <p className="text-base text-slate-600 leading-relaxed">
          Every component in XCLOUD.NET is engineered to eliminate manual router administration and unify hotspot monetization across distributed sites.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {modules.map((mod) => (
          <div key={mod.title} className="border border-slate-200 bg-white rounded-lg p-8 flex flex-col justify-between">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900 mb-3">{mod.title}</h2>
              <p className="text-sm text-slate-600 leading-relaxed mb-6">{mod.detail}</p>
            </div>
            <div className="pt-4 border-t border-slate-100 text-xs font-mono text-slate-500">{mod.specs}</div>
          </div>
        ))}
      </div>

      <div className="border border-slate-200 bg-white rounded-lg p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h3 className="font-display text-xl font-semibold text-slate-900 mb-1">
            Experience the subscriber flow live
          </h3>
          <p className="text-sm text-slate-600">
            Redeem a voucher or test a DaliPay mobile money checkout in our interactive captive portal.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/captive-portal')}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap shrink-0"
        >
          Open Captive Portal
        </button>
      </div>
    </div>
  );
}

export function PricingPage() {
  const { navigate } = useAuth();
  const [annual, setAnnual] = useState(false);

  const plans = [
    {
      name: 'Starter Site',
      audience: 'For cafes, lodges & single-building hotspots',
      monthly: 120000,
      sites: '5 Sites',
      routers: '10 Routers',
      agents: '3 Reseller Agents',
      support: 'Business Hours NOC',
    },
    {
      name: 'Regional ISP',
      audience: 'For transit hubs, markets & growing WISPs',
      monthly: 350000,
      sites: '25 Sites',
      routers: '50 Routers',
      agents: '25 Reseller Agents',
      support: 'Priority WireGuard & RADIUS SLA',
    },
    {
      name: 'Carrier Multi-Tenant',
      audience: 'For multi-organization telecom operators',
      monthly: 890000,
      sites: 'Unlimited Sites',
      routers: '150+ Routers',
      agents: 'Unlimited Agents',
      support: 'Dedicated 24/7 NOC Channel',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
        <div className="max-w-2xl">
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 text-balance mb-3">
            Predictable pricing per operator organization
          </h1>
          <p className="text-base text-slate-600">
            Zero per-voucher surcharges. Keep 100% of your DaliPay mobile money collections minus standard carrier gateway fees.
          </p>
        </div>

        <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setAnnual(false)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              !annual ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Monthly Billing
          </button>
          <button
            type="button"
            onClick={() => setAnnual(true)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              annual ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Annual (Save 15%)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
        {plans.map((p) => {
          const effectivePrice = annual ? Math.round(p.monthly * 0.85) : p.monthly;
          return (
            <div key={p.name} className="border border-slate-200 bg-white rounded-lg p-7 flex flex-col justify-between">
              <div>
                <div className="text-xs text-slate-500 mb-1">{p.audience}</div>
                <h2 className="font-display text-xl font-bold text-slate-900 mb-4">{p.name}</h2>
                <div className="flex items-baseline gap-1.5 mb-6">
                  <span className="font-mono text-3xl font-bold text-slate-900 tabular-nums">
                    TZS {effectivePrice.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-500">/ month</span>
                </div>
                <dl className="space-y-3 text-sm border-t border-slate-200 pt-5">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Hotspot Sites</dt>
                    <dd className="font-mono font-medium text-slate-900">{p.sites}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Managed Routers</dt>
                    <dd className="font-mono font-medium text-slate-900">{p.routers}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Agent Resellers</dt>
                    <dd className="font-mono font-medium text-slate-900">{p.agents}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Engineering SLA</dt>
                    <dd className="font-medium text-slate-900 text-right">{p.support}</dd>
                  </div>
                </dl>
              </div>
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="mt-8 w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
              >
                Create Organization Account
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AboutPage() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-6">
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 text-balance mb-4">
            Engineering reliable public internet infrastructure
          </h1>
          <p className="text-base text-slate-600 leading-relaxed mb-4">
            XCLOUD.NET was founded by network engineers and telecom operators who needed a unified control plane for MikroTik and Omada hardware paired with local mobile money billing.
          </p>
          <p className="text-base text-slate-600 leading-relaxed mb-6">
            Today our platform coordinates authentication, bandwidth enforcement, reseller commissions, and automated background accounting across transit hubs, hospitality properties, and regional fiber ISPs.
          </p>
          <div className="grid grid-cols-2 gap-6 border-t border-slate-200 pt-6">
            <div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">5</div>
              <div className="text-xs text-slate-500">Dedicated Role Portals</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">24/7</div>
              <div className="text-xs text-slate-500">Automated Worker Accounting</div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-6">
          <div className="rounded-lg overflow-hidden border border-slate-200">
            <ResilientImage
              src="/src/assets/images/venue_cafe_hotspot_1795468971105.jpg"
              alt="Subscribers working inside a high-speed XCLOUD.NET powered venue"
              className="w-full h-96 object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', company: '', sitesCount: '6-25 sites', message: '' });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await apiRequest('/api/public/leads', { method: 'POST', body: form });
      setSent(true);
      setForm({ name: '', email: '', company: '', sitesCount: '6-25 sites', message: '' });
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to send message.');
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 mb-3">Contact Sales &amp; NOC</h1>
      <p className="text-base text-slate-600 mb-8">
        Reach our integration engineers for WireGuard router onboarding, DaliPay merchant setup, or carrier SLA inquiries.
      </p>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-8 space-y-4">
        {sent && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-sm text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>Inquiry received. A network onboarding engineer will reply shortly.</span>
          </div>
        )}
        {err && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{err}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Message</label>
          <textarea
            rows={4}
            required
            value={form.message}
            onChange={(e) => setForm((s) => ({ ...s, message: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <button type="submit" className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer">
          Send Message
        </button>
      </form>
    </div>
  );
}

export function FaqPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const faqs = [
    {
      q: 'Which MikroTik and Omada hardware models are supported?',
      a: 'Any MikroTik device running RouterOS v6.48+ or v7.x (hEX, RB5009, CCR2004, CCR2116) and TP-Link Omada OC200/OC300/Software Controllers with EAP access points are supported out of the box.',
    },
    {
      q: 'How does DaliPay voucher issuance work on the captive portal?',
      a: 'When a subscriber enters their mobile number and chooses a plan, XCLOUD.NET dispatches a DaliPay collection prompt. As soon as the HMAC-verified webhook confirms payment, FreeRADIUS activates a time-stamped voucher and authorizes the MAC address automatically.',
    },
    {
      q: 'Can field agents sell physical or digital vouchers for cash?',
      a: 'Yes. The Agent Portal lets resellers generate vouchers for walk-in customers while recording cash sales and automatically calculating agent commission payouts.',
    },
    {
      q: 'What happens when a subscriber reaches their time or data limit?',
      a: 'The background session-disconnection worker detects expired sessions and dispatches a FreeRADIUS CoA Disconnect-Request packet to the serving router, returning the user to the captive portal.',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 mb-8">Frequently Asked Questions</h1>
      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
        {faqs.map((item, idx) => (
          <div key={item.q}>
            <button
              type="button"
              onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
              className="w-full px-6 py-5 flex items-center justify-between text-left cursor-pointer hover:bg-slate-50"
            >
              <span className="font-semibold text-sm text-slate-900 pr-4">{item.q}</span>
              <ChevronDown
                className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${openIdx === idx ? 'rotate-180' : ''}`}
              />
            </button>
            {openIdx === idx && <div className="px-6 pb-5 text-sm text-slate-600 leading-relaxed">{item.a}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LegalPage({ type }: { type: 'terms' | 'privacy' }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 space-y-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900">
        {type === 'terms' ? 'Terms of Service' : 'Privacy & Data Retention Policy'}
      </h1>
      <p className="text-sm text-slate-500">Effective Date: November 2026 · XCLOUD.NET Platform</p>
      <div className="bg-white border border-slate-200 rounded-lg p-8 space-y-4 text-sm text-slate-700 leading-relaxed">
        {type === 'terms' ? (
          <>
            <p>
              Operators provisioning MikroTik, Omada, or FreeRADIUS nodes on XCLOUD.NET agree to maintain lawful telecommunications licensing within their operating jurisdiction.
            </p>
            <p>
              DaliPay mobile money collections are settled directly to verified merchant accounts subject to carrier transaction clearing windows and anti-fraud webhook verification.
            </p>
            <p>
              Platform availability targets 99.9% uptime across RADIUS authentication endpoints and automated background billing workers.
            </p>
          </>
        ) : (
          <>
            <p>
              XCLOUD.NET stores subscriber phone numbers, MAC addresses, and FreeRADIUS session accounting logs strictly for hotspot authorization, billing reconciliation, and statutory telecom compliance.
            </p>
            <p>
              Operator credentials are hashed with per-user salts using scrypt, and session tokens are signed server-side without client storage persistence.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
