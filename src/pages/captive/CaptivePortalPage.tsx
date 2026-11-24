import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, RefreshCw, Smartphone, Ticket, Wifi } from 'lucide-react';
import type {
  DalipayProvider,
  HotspotPackage,
  PaymentGatewayCode,
  PaymentTransaction,
  RadiusSession,
  Site,
  Voucher,
} from '../../../packages/shared/types';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../services/api';
import { ResilientImage } from '../../components/ui/ResilientImage';

interface PublicGatewayOption {
  organizationId: string;
  code: PaymentGatewayCode;
  name: string;
  providerLabel: string;
  channels: string[];
  credentialsConfigured: boolean;
}

const DALIPAY_SUB_CHANNELS: { label: string; value: DalipayProvider }[] = [
  { label: 'Vodacom M-Pesa', value: 'DaliPay M-Pesa' },
  { label: 'Tigo Pesa (Mixx by Yas)', value: 'DaliPay Tigo Pesa' },
  { label: 'Airtel Money Tanzania', value: 'DaliPay Airtel Money' },
  { label: 'Halotel Halopesa', value: 'DaliPay Halopesa' },
];

export function CaptivePortalPage() {
  const { navigate } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [packages, setPackages] = useState<HotspotPackage[]>([]);
  const [enabledGateways, setEnabledGateways] = useState<PublicGatewayOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedGatewayCode, setSelectedGatewayCode] = useState<PaymentGatewayCode | ''>('');
  const [mode, setMode] = useState<'dalipay' | 'voucher'>('dalipay');

  const [phone, setPhone] = useState('+255');
  const [provider, setProvider] = useState<DalipayProvider>('DaliPay M-Pesa');
  const [voucherCode, setVoucherCode] = useState('');

  const [pendingTx, setPendingTx] = useState<PaymentTransaction | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [activeSession, setActiveSession] = useState<{ session: RadiusSession; voucher: Voucher } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<{
      sites: Site[];
      packages: HotspotPackage[];
      enabledGateways?: PublicGatewayOption[];
    }>('/api/public/catalog')
      .then((res) => {
        setSites(res.sites);
        setPackages(res.packages);
        setEnabledGateways(res.enabledGateways || []);
        if (res.sites[0]) setSelectedSiteId(res.sites[0].id);
        if (res.packages[0]) setSelectedPackageId(res.packages[0].id);
      })
      .catch(() => {});
  }, []);

  const currentSite = sites.find((s) => s.id === selectedSiteId);
  const sitePackages = useMemo(() => {
    if (!currentSite) return packages;
    return packages.filter((p) => p.organizationId === currentSite.organizationId);
  }, [currentSite, packages]);

  useEffect(() => {
    if (sitePackages.length === 0) {
      setSelectedPackageId('');
      return;
    }
    if (!sitePackages.some((p) => p.id === selectedPackageId)) {
      setSelectedPackageId(sitePackages[0].id);
    }
  }, [selectedPackageId, sitePackages]);

  const currentPkg = sitePackages.find((p) => p.id === selectedPackageId);

  const siteGateways = useMemo(() => {
    if (!currentSite) return enabledGateways;
    return enabledGateways.filter((g) => g.organizationId === currentSite.organizationId);
  }, [currentSite, enabledGateways]);

  useEffect(() => {
    if (siteGateways.length === 0) {
      setSelectedGatewayCode('');
      return;
    }
    const stillValid = siteGateways.some((g) => g.code === selectedGatewayCode);
    const chosen = stillValid
      ? siteGateways.find((g) => g.code === selectedGatewayCode)!
      : siteGateways[0];

    setSelectedGatewayCode(chosen.code);
    if (chosen.code === 'dalipay') {
      if (!DALIPAY_SUB_CHANNELS.some((c) => c.value === provider)) {
        setProvider('DaliPay M-Pesa');
      }
    } else {
      setProvider(chosen.providerLabel as DalipayProvider);
    }
  }, [provider, selectedGatewayCode, siteGateways]);

  const activeGateway = siteGateways.find((g) => g.code === selectedGatewayCode) || siteGateways[0];

  // Poll real payment webhook settlement status while a payment is pending
  useEffect(() => {
    if (!pendingTx) return;
    const reference = pendingTx.reference;

    const pollStatus = async () => {
      try {
        const res = await apiRequest<{
          payment: PaymentTransaction;
          voucher?: Voucher;
          session?: RadiusSession;
        }>(`/api/captive/payment-status/${reference}`);
        if (res.payment.status === 'Completed' && res.voucher && res.session) {
          setPendingTx(null);
          setActiveSession({ voucher: res.voucher, session: res.session });
        } else if (res.payment.status === 'Failed') {
          setPendingTx(null);
          setError('Mobile money transaction failed or expired. Please try again.');
        }
      } catch {
        // Keep polling until webhook updates or user cancels
      }
    };

    const timer = window.setInterval(() => {
      void pollStatus();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [pendingTx]);

  const handleVoucherAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ voucher: Voucher; session: RadiusSession }>('/api/captive/authenticate', {
        method: 'POST',
        body: { voucherCode, phone: phone.trim().length > 4 ? phone.trim() : undefined },
      });
      setActiveSession(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to authenticate voucher.');
    } finally {
      setLoading(false);
    }
  };

  const handleInitiatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGateway) {
      setError('No mobile money gateway is enabled for this hotspot site yet.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const resolvedProvider: DalipayProvider =
        activeGateway.code === 'dalipay'
          ? provider
          : (activeGateway.providerLabel as DalipayProvider);

      const res = await apiRequest<{ payment: PaymentTransaction }>('/api/captive/purchase', {
        method: 'POST',
        body: {
          siteId: selectedSiteId,
          packageId: selectedPackageId,
          customerPhone: phone,
          gatewayCode: activeGateway.code,
          provider: resolvedProvider,
        },
      });
      setPendingTx(res.payment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate mobile money collection.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualStatusRefresh = async () => {
    if (!pendingTx) return;
    setCheckingPayment(true);
    setError('');
    try {
      const res = await apiRequest<{
        payment: PaymentTransaction;
        voucher?: Voucher;
        session?: RadiusSession;
      }>(`/api/captive/payment-status/${pendingTx.reference}`);
      if (res.payment.status === 'Completed' && res.voucher && res.session) {
        setPendingTx(null);
        setActiveSession({ voucher: res.voucher, session: res.session });
      } else if (res.payment.status === 'Failed') {
        setPendingTx(null);
        setError('Mobile money transaction failed or was declined.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify payment status.');
    } finally {
      setCheckingPayment(false);
    }
  };

  const handleSelectGateway = (gw: PublicGatewayOption) => {
    setSelectedGatewayCode(gw.code);
    if (gw.code === 'dalipay') {
      setProvider('DaliPay M-Pesa');
    } else {
      setProvider(gw.providerLabel as DalipayProvider);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-between bg-slate-900">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <ResilientImage
          src="/src/assets/images/captive_portal_backdrop_1795468971554.jpg"
          alt="Modern atrium WiFi hotspot venue"
          className="w-full h-full object-cover opacity-35"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/75 via-slate-950/65 to-slate-950/85" />
      </div>

      <header className="relative z-10 max-w-6xl w-full mx-auto px-6 py-5 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-200 hover:text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to XCLOUD.NET</span>
        </button>
        <div className="text-xs font-mono text-slate-300">
          SSID: {currentSite?.ssid || 'No Active Site'}
        </div>
      </header>

      <main className="relative z-10 max-w-5xl w-full mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Context & Plan Summary */}
          <div className="lg:col-span-5 text-white space-y-6 pt-2">
            <div>
              <p className="text-xs font-semibold text-blue-300 mb-2">Tanzania Hotspot Captive Portal</p>
              <h1 className="font-display text-3xl font-bold tracking-tight text-balance">
                {currentSite?.captivePortalTitle || 'High-Speed Public Wireless'}
              </h1>
              <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                Select a WiFi bundle and pay via Vodacom M-Pesa, Tigo Pesa, Airtel Money, Selcom Pay, AzamPay, or DaliPay, or redeem an active voucher code from an authorized agent.
              </p>
            </div>

            <div className="bg-slate-900/80 border border-slate-700 rounded-lg p-5 space-y-3">
              <label className="block text-xs font-semibold text-slate-300">Active Hotspot Site</label>
              {sites.length > 0 ? (
                <select
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 text-white rounded-md"
                >
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name} ({site.location})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="px-3 py-2 text-xs bg-slate-950 border border-slate-800 text-slate-400 rounded-md">
                  No active hotspot sites have been published by an operator yet.
                </div>
              )}
              <div className="text-xs text-slate-400 flex items-center justify-between pt-1">
                <span>Connected Devices Here</span>
                <span className="font-mono text-slate-200 tabular-nums">{currentSite?.activeUsers ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Right Interactive Portal Card */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-7 shadow-lg">
            {activeSession ? (
              <div className="space-y-6">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="font-display text-xl font-bold text-slate-900">Device Connected to Internet</h2>
                    <p className="text-sm text-slate-600 mt-1">
                      FreeRADIUS Access-Accept granted for voucher{' '}
                      <span className="font-mono font-semibold text-slate-900">{activeSession.voucher.code}</span>.
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-4 border-y border-slate-200 py-5 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Package</dt>
                    <dd className="font-semibold text-slate-900">{activeSession.voucher.packageName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Remaining Window</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {activeSession.session.remainingMinutes} min
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Assigned Framed IP</dt>
                    <dd className="font-mono text-slate-900">{activeSession.session.framedIp}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Client MAC Address</dt>
                    <dd className="font-mono text-slate-900">{activeSession.session.macAddress}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Serving Router NAS</dt>
                    <dd className="font-mono text-slate-900">{activeSession.session.routerName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Usage (Down / Up)</dt>
                    <dd className="font-mono text-slate-900 tabular-nums">
                      {activeSession.session.downloadMb} MB / {activeSession.session.uploadMb} MB
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveSession(null)}
                    className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                  >
                    Authorize Another Device
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/login')}
                    className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                  >
                    Inspect Session in Admin Console
                  </button>
                </div>
              </div>
            ) : pendingTx ? (
              <div className="space-y-6">
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">Awaiting Mobile Money PIN Approval</h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Enter your mobile money PIN on <span className="font-mono font-semibold">{pendingTx.customerPhone}</span> ({pendingTx.provider}). Your WiFi access will activate automatically once payment confirms.
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-md p-5 space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reference</span>
                    <span className="font-mono font-semibold text-slate-900">{pendingTx.reference}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Selected Pass</span>
                    <span className="font-medium text-slate-900">{pendingTx.packageName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Amount Due</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      TZS {pendingTx.amountTzs.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Webhook Status</span>
                    <span className="font-mono text-xs font-semibold text-amber-700">Polling every 3s · Pending</span>
                  </div>
                </div>

                {error && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>}

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setPendingTx(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel Payment
                  </button>
                  <button
                    type="button"
                    disabled={checkingPayment}
                    onClick={handleManualStatusRefresh}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${checkingPayment ? 'animate-spin' : ''}`} />
                    <span>{checkingPayment ? 'Checking Status...' : 'Check Settlement Status'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('dalipay');
                      setError('');
                    }}
                    className={`flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      mode === 'dalipay' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Buy Pass via Mobile Money</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('voucher');
                      setError('');
                    }}
                    className={`flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      mode === 'voucher' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Ticket className="w-3.5 h-3.5" />
                    <span>Redeem Voucher Code</span>
                  </button>
                </div>

                {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>}

                {mode === 'dalipay' ? (
                  <form onSubmit={handleInitiatePayment} className="space-y-5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">1. Choose Internet Package</label>
                      {sitePackages.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {sitePackages.map((pkg) => {
                            const selected = pkg.id === selectedPackageId;
                            return (
                              <button
                                key={pkg.id}
                                type="button"
                                onClick={() => setSelectedPackageId(pkg.id)}
                                className={`text-left p-3.5 rounded-md border transition-colors cursor-pointer ${
                                  selected
                                    ? 'border-blue-700 bg-blue-50/50'
                                    : 'border-slate-200 hover:border-slate-300 bg-white'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold text-slate-900">{pkg.name}</span>
                                  <span className="font-mono text-sm font-bold text-blue-700 tabular-nums">
                                    TZS {pkg.priceTzs.toLocaleString()}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                  {pkg.downloadMbps} Mbps · {pkg.dataCapGb ? `${pkg.dataCapGb} GB Cap` : 'Unlimited Data'}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-4 border border-slate-200 rounded-md text-xs text-slate-500 bg-slate-50">
                          No internet packages are currently published. An operator must create at least one package first.
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">
                        2. Payment Gateway
                      </label>
                      {siteGateways.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {siteGateways.map((gw) => {
                            const selected = activeGateway?.code === gw.code;
                            return (
                              <button
                                key={gw.code}
                                type="button"
                                onClick={() => handleSelectGateway(gw)}
                                className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                                  selected
                                    ? 'border-blue-700 bg-blue-50/50'
                                    : 'border-slate-200 hover:border-slate-300 bg-white'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-slate-900">{gw.name}</span>
                                  {!gw.credentialsConfigured && (
                                    <span className="font-mono text-[10px] text-amber-700">Keys Pending</span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-1">
                                  {gw.channels.join(' · ')}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-4 border border-amber-200 bg-amber-50/60 rounded-md text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <span>
                            No mobile money payment gateway has been enabled by this site operator yet. You can still connect using a reseller voucher code.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setMode('voucher');
                              setError('');
                            }}
                            className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer shrink-0 self-start sm:self-auto"
                          >
                            Use Voucher
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {activeGateway?.code === 'dalipay' ? (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            3. Mobile Money Network
                          </label>
                          <select
                            value={provider}
                            onChange={(e) => setProvider(e.target.value as DalipayProvider)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                          >
                            {DALIPAY_SUB_CHANNELS.map((ch) => (
                              <option key={ch.value} value={ch.value}>
                                {ch.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            3. Selected Checkout Method
                          </label>
                          <div className="px-3 py-2 text-sm border border-slate-200 bg-slate-50 rounded-md text-slate-700">
                            {activeGateway ? activeGateway.providerLabel : 'Not configured'}
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          4. Tanzanian Phone Number
                        </label>
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+255754123456"
                          className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading || !currentPkg || !currentSite || !activeGateway}
                      className="w-full py-3 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer inline-flex items-center justify-center gap-2"
                    >
                      <Wifi className="w-4 h-4" />
                      <span>
                        {loading
                          ? 'Sending Mobile Money Prompt...'
                          : currentPkg
                          ? `Pay TZS ${currentPkg.priceTzs.toLocaleString()} & Connect Now`
                          : 'Select Site & Package'}
                      </span>
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleVoucherAuth} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Enter WiFi Voucher Code
                      </label>
                      <input
                        type="text"
                        required
                        value={voucherCode}
                        onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                        placeholder="TZ-0000-XXX"
                        className="w-full px-3.5 py-2.5 text-base font-mono tracking-wider border border-slate-300 rounded-md uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Optional Phone Receipt</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+255754..."
                        className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-md"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md cursor-pointer"
                    >
                      {loading ? 'Authenticating via FreeRADIUS...' : 'Activate WiFi Voucher'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="relative z-10 max-w-6xl w-full mx-auto px-6 py-4 text-xs text-slate-400 flex items-center justify-between">
        <span>Secured by XCLOUD.NET Tanzania FreeRADIUS</span>
        <span>M-Pesa · Tigo Pesa · Airtel Money · Selcom · AzamPay · DaliPay</span>
      </footer>
    </div>
  );
}
