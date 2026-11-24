import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Globe,
  KeyRound,
  Network,
  RefreshCw,
  Router as RouterIcon,
  ShieldCheck,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import type { RouterDevice, RouterVendor, Site } from '../../../packages/shared/types';
import { apiRequest } from '../../services/api';
import { generateRouterAutoScript } from '../../utils/routerScripts';
import { StatusText } from '../ui/StatusText';

interface ConnectionCheckItem {
  id: string;
  label: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  detail: string;
}

interface ConnectionTestResponse {
  validCredentials: boolean;
  reachable: boolean;
  authenticated: boolean;
  isPrivateAddress: boolean;
  latencyMs: number | null;
  systemInfo: {
    boardName?: string;
    version?: string;
    uptime?: string;
    cpuLoad?: number;
  } | null;
  checks: ConnectionCheckItem[];
  message: string;
}

interface AddRouterWizardProps {
  token: string;
  sites: Site[];
  onClose: () => void;
  onCreated: (router: RouterDevice) => Promise<void> | void;
  notify: (msg: string) => void;
}

const STEPS = [
  { id: 1, label: '01. Hardware & Network' },
  { id: 2, label: '02. Credentials & Test' },
  { id: 3, label: '03. Auto-Script' },
  { id: 4, label: '04. Review & Save' },
] as const;

type ScriptTab =
  | 'full'
  | 'wireguard'
  | 'bridge'
  | 'hotspot'
  | 'captive'
  | 'keepalive'
  | 'serverPeer'
  | 'wgQuick';

interface GeneratedWgConfig {
  tunnelIp: string;
  clientPrivateKey: string;
  clientPublicKey: string;
  presharedKey: string;
  serverPublicKey: string;
  serverEndpoint: string;
}

export function AddRouterWizard({ token, sites, onClose, onCreated, notify }: AddRouterWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Hardware & Network Topology
  const [vendor, setVendor] = useState<RouterVendor>('MikroTik');
  const [siteId, setSiteId] = useState(sites[0]?.id || '');
  const [name, setName] = useState('');
  const [model, setModel] = useState('MikroTik RB5009UG+S+IN');
  const [ipAddress, setIpAddress] = useState('');
  const [detectingWan, setDetectingWan] = useState(false);
  const [wanStatusMessage, setWanStatusMessage] = useState('');
  const [wireguardTunnelIp, setWireguardTunnelIp] = useState('10.66.0.21');
  const [wireguardEndpoint, setWireguardEndpoint] = useState('vpn.xcloud.co.tz:51820');
  const [wireguardClientPrivateKey, setWireguardClientPrivateKey] = useState('');
  const [wireguardClientPublicKey, setWireguardClientPublicKey] = useState('');
  const [wireguardPresharedKey, setWireguardPresharedKey] = useState('');
  const [generatingWg, setGeneratingWg] = useState(false);
  const [bridgeName, setBridgeName] = useState('bridge-hotspot');
  const [bridgePorts, setBridgePorts] = useState('ether2,ether3,ether4,wlan1');
  const [hotspotSubnet, setHotspotSubnet] = useState('10.5.50.0/24');

  // Step 2: Credentials & Connection Test
  const [apiPort, setApiPort] = useState('443');
  const [username, setUsername] = useState('xcloud-api');
  const [password, setPassword] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResponse | null>(null);
  const [testError, setTestError] = useState('');

  // Step 3: Auto-Script Inspection
  const [scriptTab, setScriptTab] = useState<ScriptTab>('full');
  const [wireguardPublicKey, setWireguardPublicKey] = useState('');
  const [radiusSecretOverride, setRadiusSecretOverride] = useState('');
  const [copiedScript, setCopiedScript] = useState(false);

  // Step 4: Save & Post-Save One-Line Bootstrap
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdRouter, setCreatedRouter] = useState<RouterDevice | null>(null);
  const [oneLineBootstrap, setOneLineBootstrap] = useState<{
    oneLineCommand: string;
    expiresAt: string;
  } | null>(null);
  const [copiedOneLiner, setCopiedOneLiner] = useState(false);

  const generateWireGuardKeys = useCallback(
    async (silent = false) => {
      setGeneratingWg(true);
      try {
        const res = await apiRequest<GeneratedWgConfig>('/api/routers/wireguard/generate', {
          method: 'POST',
          token,
        });
        setWireguardTunnelIp(res.tunnelIp);
        setWireguardEndpoint(res.serverEndpoint);
        setWireguardPublicKey(res.serverPublicKey);
        setWireguardClientPrivateKey(res.clientPrivateKey);
        setWireguardClientPublicKey(res.clientPublicKey);
        setWireguardPresharedKey(res.presharedKey);
        if (!silent) {
          notify(`Generated WireGuard X25519 keypair (${res.tunnelIp}).`);
        }
      } catch {
        // Keep current values if offline/unavailable
      } finally {
        setGeneratingWg(false);
      }
    },
    [notify, token]
  );

  const effectiveSiteId = siteId || sites[0]?.id || '';
  const selectedSite = sites.find((s) => s.id === effectiveSiteId);

  const buildSuggestedIdentity = useCallback(
    (targetVendor: RouterVendor, targetSite?: Site) => {
      const prefix = targetVendor === 'MikroTik' ? 'MIK' : 'OMD';
      const siteCode = (targetSite?.name || 'TZ')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 8) || 'TZ';
      const octet = wireguardTunnelIp.split('.').pop() || '01';
      return `${prefix}-${siteCode}-${octet.padStart(2, '0')}`;
    },
    [wireguardTunnelIp]
  );

  const detectWanAddress = useCallback(
    async (silent = false) => {
      setDetectingWan(true);
      if (!silent) setWanStatusMessage('');
      try {
        let res = await apiRequest<{
          detected: boolean;
          publicIp: string | null;
          reverseHost: string | null;
          openPorts: { port: number; latencyMs: number }[];
          recommendedPort: number;
          message: string;
        }>('/api/routers/detect-wan', {
          method: 'POST',
          token,
          body: { vendor, probePorts: true },
        });

        // If server observed local/loopback IP, query browser public IP echo and probe ports via backend
        if (!res.detected) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          try {
            const ipifyResp = await fetch('https://api.ipify.org?format=json', {
              signal: controller.signal,
            });
            if (ipifyResp.ok) {
              const ipifyJson = (await ipifyResp.json().catch(() => null)) as { ip?: string } | null;
              if (ipifyJson?.ip) {
                res = await apiRequest('/api/routers/detect-wan', {
                  method: 'POST',
                  token,
                  body: {
                    vendor,
                    candidateIp: ipifyJson.ip,
                    probePorts: true,
                  },
                });
              }
            }
          } catch {
            // Browser offline / blocked external echo; keep server response
          } finally {
            clearTimeout(timer);
          }
        }

        setWanStatusMessage(res.message);
        if (res.detected && res.publicIp) {
          setIpAddress((prev) => (silent && prev.trim() ? prev : res.publicIp!));
          setTestResult(null);
          if (res.openPorts.length > 0) {
            setApiPort(String(res.recommendedPort));
          }
          if (!silent) {
            notify(`Detected public WAN IP: ${res.publicIp}`);
          }
        } else if (!silent) {
          notify('No public WAN IP observed — using WireGuard tunnel or manual DDNS.');
        }
      } catch (err) {
        if (!silent) {
          setWanStatusMessage(err instanceof Error ? err.message : 'Unable to detect public WAN IP.');
        }
      } finally {
        setDetectingWan(false);
      }
    },
    [notify, token, vendor]
  );

  const didInitRef = useRef(false);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    generateWireGuardKeys(true);
    detectWanAddress(true);
  }, [detectWanAddress, generateWireGuardKeys]);

  useEffect(() => {
    if (!name.trim() && selectedSite) {
      setName(buildSuggestedIdentity(vendor, selectedSite));
    }
  }, [buildSuggestedIdentity, name, selectedSite, vendor]);

  const handleVendorSwitch = (nextVendor: RouterVendor) => {
    setVendor(nextVendor);
    setTestResult(null);
    setTestError('');
    if (nextVendor === 'MikroTik') {
      setModel('MikroTik RB5009UG+S+IN');
      setApiPort('443');
      setBridgePorts('ether2,ether3,ether4,wlan1');
    } else {
      setModel('Omada OC300 / ER605');
      setApiPort('8043');
      setBridgePorts('LAN1,LAN2,WLAN-Hotspot');
    }
  };

  const step1Valid =
    Boolean(effectiveSiteId) &&
    name.trim().length >= 2 &&
    ipAddress.trim().length >= 3 &&
    bridgeName.trim().length >= 2 &&
    hotspotSubnet.trim().length >= 7;

  const step2CredentialsValid =
    Number(apiPort) >= 1 &&
    Number(apiPort) <= 65535 &&
    username.trim().length >= 2 &&
    password.length >= 6;

  const scripts = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://portal.xcloud.co.tz';
    return generateRouterAutoScript({
      vendor,
      routerName: name || 'MIK-TZ-01',
      model,
      site: selectedSite,
      wanHost: ipAddress.trim() || 'router.example.co.tz',
      apiPort: Number(apiPort) || (vendor === 'Omada' ? 8043 : 443),
      apiUsername: username.trim() || 'xcloud-api',
      wireguardTunnelIp,
      wireguardEndpoint,
      wireguardPublicKey,
      wireguardClientPrivateKey,
      wireguardClientPublicKey,
      wireguardPresharedKey,
      radiusSecret: radiusSecretOverride,
      bridgeName,
      bridgePorts,
      hotspotSubnet,
      captivePortalOrigin: origin,
    });
  }, [
    apiPort,
    bridgeName,
    bridgePorts,
    hotspotSubnet,
    ipAddress,
    model,
    name,
    radiusSecretOverride,
    selectedSite,
    username,
    vendor,
    wireguardClientPrivateKey,
    wireguardClientPublicKey,
    wireguardEndpoint,
    wireguardPresharedKey,
    wireguardPublicKey,
    wireguardTunnelIp,
  ]);

  const activeScriptText =
    scriptTab === 'wireguard'
      ? scripts.wireguard
      : scriptTab === 'bridge'
      ? scripts.bridge
      : scriptTab === 'hotspot'
      ? scripts.hotspot
      : scriptTab === 'captive'
      ? scripts.captivePortal
      : scriptTab === 'keepalive'
      ? scripts.keepalive
      : scriptTab === 'serverPeer'
      ? scripts.serverPeerConfig
      : scriptTab === 'wgQuick'
      ? scripts.wgQuickConf
      : scripts.fullScript;

  const runConnectionTest = async () => {
    setTestError('');
    setTestResult(null);
    setTestingConnection(true);
    try {
      const res = await apiRequest<ConnectionTestResponse>('/api/routers/test-connection', {
        method: 'POST',
        token,
        body: {
          vendor,
          ipAddress: ipAddress.trim(),
          apiPort: Number(apiPort),
          username: username.trim(),
          password,
        },
      });
      setTestResult(res);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Unable to execute router connection test.');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleCopyScript = () => {
    navigator.clipboard?.writeText(activeScriptText).catch(() => {});
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 1600);
  };

  const handleDownloadScript = () => {
    const blob = new Blob([scripts.fullScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = scripts.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify(`Downloaded ${scripts.filename}`);
  };

  const handleProvisionRouter = async () => {
    setSaveError('');
    setSubmitting(true);
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://portal.xcloud.co.tz';
      const res = await apiRequest<{ router: RouterDevice }>('/api/routers', {
        method: 'POST',
        token,
        body: {
          name: name.trim(),
          vendor,
          model: model.trim(),
          ipAddress: ipAddress.trim(),
          siteId: effectiveSiteId,
          apiPort: Number(apiPort),
          wireguardTunnelIp: wireguardTunnelIp.trim(),
          wireguardPublicKey: wireguardClientPublicKey || undefined,
          bridgeName: bridgeName.trim(),
          hotspotSubnet: hotspotSubnet.trim(),
        },
      });
      setCreatedRouter(res.router);

      try {
        const tokenRes = await apiRequest<{ oneLineCommand: string; expiresAt: string }>(
          `/api/routers/${res.router.id}/provision-token`,
          {
            method: 'POST',
            token,
            body: {
              origin,
              wireguardEndpoint: wireguardEndpoint.trim(),
              serverPublicKey: wireguardPublicKey.trim() || undefined,
              clientPrivateKey: wireguardClientPrivateKey || undefined,
              clientPublicKey: wireguardClientPublicKey || undefined,
              presharedKey: wireguardPresharedKey || undefined,
              bridgePorts: bridgePorts.trim(),
            },
          }
        );
        setOneLineBootstrap(tokenRes);
      } catch {
        // Non-blocking: script download remains available even if token minting fails
      }

      notify(`Router ${res.router.name} registered (${res.router.status}).`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to provision router NAS.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Add Router Provisioning Wizard"
      className="border border-slate-300 bg-white rounded-lg overflow-hidden"
    >
      {/* Wizard Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <RouterIcon className="w-5 h-5 text-blue-700 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-slate-900 truncate">
              Add Router Provisioning Wizard
            </h3>
            <p className="text-xs text-slate-500">
              Guided hardware onboarding, credential verification, and WireGuard + Bridge + Hotspot + Captive Portal auto-script
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer shrink-0"
          aria-label="Close router wizard"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 4-Step Segmented Progress Bar */}
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 overflow-x-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STEPS.map((item) => {
            const isCurrent = step === item.id;
            const isCompleted = step > item.id;
            const disabled = item.id > 1 && !step1Valid;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => setStep(item.id)}
                className={`px-3 py-2 text-left text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-between gap-2 ${
                  isCurrent
                    ? 'bg-white border-blue-700 text-blue-700'
                    : isCompleted
                    ? 'bg-white border-slate-200 text-slate-900 hover:border-slate-300'
                    : 'bg-transparent border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {isCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Wizard Body */}
      <div className="p-6 space-y-6">
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <span className="block text-xs font-semibold text-slate-700 mb-2">1. Select Hardware Platform</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['MikroTik', 'Omada'] as const).map((v) => {
                  const selected = vendor === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => handleVendorSwitch(v)}
                      className={`p-4 text-left rounded-md border transition-colors cursor-pointer ${
                        selected
                          ? 'border-blue-700 bg-blue-50/50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="text-sm font-bold text-slate-900">
                        {v === 'MikroTik' ? 'MikroTik RouterOS v7' : 'TP-Link Omada Controller'}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {v === 'MikroTik'
                          ? 'Generates .rsc CLI script for WireGuard, RSTP Bridge, Hotspot & Walled Garden'
                          : 'Generates Omada Gateway WireGuard, LAN VLAN/Bridge, FreeRADIUS & External Portal config'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Hotspot Site</label>
                <select
                  value={effectiveSiteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                >
                  {sites.length === 0 ? (
                    <option value="">No sites configured</option>
                  ) : (
                    sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} ({site.ssid})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">Router Host Identity</label>
                  <button
                    type="button"
                    onClick={() => setName(buildSuggestedIdentity(vendor, selectedSite))}
                    className="text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    Auto-Name
                  </button>
                </div>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={vendor === 'MikroTik' ? 'MIK-DAR-01' : 'OMD-ARUSHA-01'}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Hardware Model</label>
                <input
                  required
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="RB5009UG+S+IN"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">WAN IP / Controller Host</label>
                <input
                  required
                  value={ipAddress}
                  onChange={(e) => {
                    setIpAddress(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="41.59.22.10 or nas.isp.co.tz"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={detectingWan}
                    onClick={() => detectWanAddress(false)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    <Globe className={`w-3 h-3 ${detectingWan ? 'animate-spin' : ''}`} />
                    <span>{detectingWan ? 'Detecting WAN...' : 'Detect WAN IP'}</span>
                  </button>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIpAddress(wireguardTunnelIp);
                      setTestResult(null);
                      setWanStatusMessage(
                        `Using WireGuard tunnel IP ${wireguardTunnelIp} (recommended for CGNAT, LTE, or dynamic WAN).`
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-blue-700 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    <Network className="w-3 h-3" />
                    <span>Use WG Tunnel ({wireguardTunnelIp})</span>
                  </button>
                </div>
              </div>
            </div>

            {wanStatusMessage && (
              <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2">
                {wanStatusMessage}
              </div>
            )}

            <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">WireGuard Tunnel IP</label>
                <input
                  value={wireguardTunnelIp}
                  onChange={(e) => setWireguardTunnelIp(e.target.value)}
                  placeholder="10.66.0.21"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">WireGuard VPN Endpoint</label>
                <input
                  value={wireguardEndpoint}
                  onChange={(e) => setWireguardEndpoint(e.target.value)}
                  placeholder="vpn.xcloud.co.tz:51820"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Bridge / VLAN Name</label>
                <input
                  value={bridgeName}
                  onChange={(e) => setBridgeName(e.target.value)}
                  placeholder="bridge-hotspot"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {vendor === 'MikroTik' ? 'Bridge Ports (comma)' : 'LAN / WLAN Bindings'}
                </label>
                <input
                  value={bridgePorts}
                  onChange={(e) => setBridgePorts(e.target.value)}
                  placeholder="ether2,ether3,wlan1"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Hotspot LAN Subnet</label>
                <input
                  value={hotspotSubnet}
                  onChange={(e) => setHotspotSubnet(e.target.value)}
                  placeholder="10.5.50.0/24"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="border border-slate-200 bg-slate-50/70 rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <KeyRound className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                  <span>Auto-Generated WireGuard X25519 Keypair &amp; PresharedKey</span>
                </div>
                <div className="text-[11px] font-mono text-slate-600 truncate">
                  Router Public Key: {wireguardClientPublicKey || 'Generating X25519 keys...'}
                </div>
                <div className="text-[11px] font-mono text-slate-500 truncate">
                  Hub Public Key: {wireguardPublicKey || 'Auto-resolving hub key...'}
                </div>
              </div>
              <button
                type="button"
                disabled={generatingWg}
                onClick={() => generateWireGuardKeys(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-md cursor-pointer whitespace-nowrap shrink-0 self-start lg:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-700 ${generatingWg ? 'animate-spin' : ''}`} />
                <span>{generatingWg ? 'Generating...' : 'Regenerate WG Keys'}</span>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h4 className="font-display text-sm font-bold text-slate-900">
                  API Credential Validation &amp; Live Reachability Probe
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Target: <span className="font-mono text-slate-800">{vendor}</span> ·{' '}
                  <span className="font-mono text-slate-800">{ipAddress.trim()}</span> · Passwords are verified in memory and never stored in browser or database plaintext.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 shrink-0">
                <ShieldCheck className="w-4 h-4 text-blue-700" />
                <span>SSRF-Protected Probe</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {vendor === 'MikroTik' ? 'HTTPS / API-SSL Port' : 'Controller HTTPS Port'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={apiPort}
                  onChange={(e) => {
                    setApiPort(e.target.value);
                    setTestResult(null);
                  }}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">API / Management Username</label>
                <input
                  required
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="xcloud-api"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">API Password / Token (min 6 chars)</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={testingConnection || !step2CredentialsValid}
                onClick={runConnectionTest}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testingConnection ? 'animate-spin' : ''}`} />
                <span>{testingConnection ? 'Testing Router Connection...' : 'Validate Credentials & Test Connection'}</span>
              </button>
              {!step2CredentialsValid && (
                <span className="text-xs text-slate-500">
                  Enter a valid port (1–65535), username (2+ chars), and password (6+ chars) to run the test.
                </span>
              )}
            </div>

            {testError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
                {testError}
              </div>
            )}

            {testResult && (
              <div className="border border-slate-200 bg-slate-50/70 rounded-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {testResult.authenticated ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    ) : testResult.isPrivateAddress || testResult.reachable ? (
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-700 shrink-0" />
                    )}
                    <span className="text-xs font-bold text-slate-900">
                      {testResult.authenticated
                        ? 'Connection & Credentials Verified'
                        : testResult.isPrivateAddress
                        ? 'Private Tunnel IP — Pending WireGuard Handshake'
                        : testResult.reachable
                        ? 'TCP Reachable — Authentication Attention Needed'
                        : 'Hardware Unreachable from Cloud'}
                    </span>
                  </div>
                  {testResult.latencyMs !== null && (
                    <span className="font-mono text-xs text-slate-600 tabular-nums">
                      Latency: {testResult.latencyMs} ms
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-700 leading-relaxed">{testResult.message}</p>

                <div className="divide-y divide-slate-200 border-t border-slate-200 pt-2">
                  {testResult.checks.map((chk) => (
                    <div key={chk.id} className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                      <div>
                        <span className="font-semibold text-slate-900">{chk.label}</span>
                        <span className="text-slate-500 ml-2">{chk.detail}</span>
                      </div>
                      <StatusText
                        status={
                          chk.status === 'passed'
                            ? 'Active'
                            : chk.status === 'warning'
                            ? 'Pending'
                            : chk.status === 'skipped'
                            ? 'Paused'
                            : 'Failed'
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h4 className="font-display text-sm font-bold text-slate-900">
                  Auto-Provisioning Script · WireGuard, Bridge, Hotspot &amp; Captive Portal
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Includes WireGuard tunnel ({wireguardTunnelIp}), Bridge ({bridgeName} · {hotspotSubnet}), FreeRADIUS Hotspot, and Walled Garden for {selectedSite?.ssid || 'your site'}.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyScript}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedScript ? 'Copied' : 'Copy Script'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadScript}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download {vendor === 'MikroTik' ? '.rsc' : '.sh'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Hub Server WireGuard Public Key
                </label>
                <input
                  value={wireguardPublicKey}
                  onChange={(e) => setWireguardPublicKey(e.target.value)}
                  placeholder="<XCLOUD_SERVER_WG_PUBLIC_KEY>"
                  className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  FreeRADIUS Shared Secret (Optional)
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={radiusSecretOverride}
                  onChange={(e) => setRadiusSecretOverride(e.target.value)}
                  placeholder="<SET_RADIUS_SHARED_SECRET>"
                  className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'full', label: 'Full Auto-Script' },
                  { id: 'wireguard', label: '1. WireGuard' },
                  { id: 'bridge', label: '2. Bridge & DHCP' },
                  { id: 'hotspot', label: '3. Hotspot & RADIUS' },
                  { id: 'captive', label: '4. Captive Portal' },
                  { id: 'keepalive', label: '5. Keepalive' },
                  { id: 'wgQuick', label: 'WG Tunnel .conf' },
                  { id: 'serverPeer', label: 'Hub Server [Peer]' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setScriptTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    scriptTab === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <pre className="bg-slate-950 text-slate-100 rounded-md p-4 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-96">
              {activeScriptText}
            </pre>

            <p className="text-xs text-slate-500">
              {scripts.languageLabel} includes auto-generated X25519 WireGuard private/preshared keys, Bridge &amp; DHCP, Hotspot &amp; FreeRADIUS, CoA 3799, Captive Portal redirect, and Hub Server [Peer] block.
            </p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h4 className="font-display text-sm font-bold text-slate-900">Review &amp; Register Router NAS</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Confirm hardware profile and provisioning state before registering this NAS in XCLOUD.NET.
              </p>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 border-y border-slate-200 py-4 text-xs">
              <div>
                <dt className="text-slate-500">Vendor · Model</dt>
                <dd className="font-semibold text-slate-900 mt-0.5">{vendor} · {model}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Host Identity</dt>
                <dd className="font-mono font-semibold text-slate-900 mt-0.5">{name.trim().toUpperCase()}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Assigned Hotspot Site</dt>
                <dd className="font-semibold text-slate-900 mt-0.5">
                  {selectedSite?.name || 'Unassigned'} ({selectedSite?.ssid || 'N/A'})
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">WAN IP / Controller · Port</dt>
                <dd className="font-mono text-slate-900 mt-0.5">
                  {ipAddress.trim()} : {apiPort}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">WireGuard Tunnel IP · Public Key</dt>
                <dd className="font-mono text-slate-900 mt-0.5 truncate" title={wireguardClientPublicKey}>
                  {wireguardTunnelIp} · {wireguardClientPublicKey ? `${wireguardClientPublicKey.slice(0, 14)}...` : 'Auto'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Bridge · Hotspot Subnet</dt>
                <dd className="font-mono text-slate-900 mt-0.5">
                  {bridgeName} · {hotspotSubnet}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Initial NAS Status</dt>
                <dd className="mt-0.5">
                  <StatusText status={testResult?.reachable && testResult?.authenticated ? 'Online' : 'Offline'} />
                  <span className="text-slate-500 ml-2">
                    {testResult?.reachable && testResult?.authenticated
                      ? '(Live probe verified)'
                      : '(Awaiting WireGuard tunnel sync)'}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Auto-Script Modules</dt>
                <dd className="text-slate-700 mt-0.5">WireGuard X25519 · Bridge &amp; DHCP · Hotspot &amp; RADIUS · Captive Portal · Keepalive</dd>
              </div>
            </dl>

            {createdRouter && (
              <div className="border border-emerald-200 bg-emerald-50/50 rounded-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>{createdRouter.name} Provisioned in XCLOUD.NET</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadScript}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-700" />
                    <span>Download {scripts.filename}</span>
                  </button>
                </div>

                {oneLineBootstrap && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-700">
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <Terminal className="w-3.5 h-3.5 text-blue-700" />
                        <span>One-Line Auto-Provision Terminal Command (30m TTL)</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        Expires {new Date(oneLineBootstrap.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-slate-950 text-slate-100 rounded-md px-3 py-2.5">
                      <code className="font-mono text-[11px] overflow-x-auto whitespace-nowrap">
                        {oneLineBootstrap.oneLineCommand}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(oneLineBootstrap.oneLineCommand).catch(() => {});
                          setCopiedOneLiner(true);
                          notify('One-line auto-provision command copied.');
                          setTimeout(() => setCopiedOneLiner(false), 1600);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 hover:text-white cursor-pointer shrink-0 ml-2"
                      >
                        {copiedOneLiner ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedOneLiner ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {saveError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
                {saveError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Wizard Footer Controls */}
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            if (createdRouter) {
              onCreated(createdRouter);
              return;
            }
            if (step === 1) {
              onClose();
            } else {
              setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
            }
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>{createdRouter ? 'Close & View Router' : step === 1 ? 'Cancel' : 'Back'}</span>
        </button>

        {step < 4 ? (
          <button
            type="button"
            disabled={(step === 1 && !step1Valid) || (step === 2 && !step2CredentialsValid)}
            onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
          >
            <span>
              {step === 2 && !testResult
                ? 'Skip Live Probe & Continue to Script'
                : 'Continue'}
            </span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : createdRouter ? (
          <button
            type="button"
            onClick={() => onCreated(createdRouter)}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Done &amp; Refresh Fleet</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting || !step1Valid}
            onClick={handleProvisionRouter}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{submitting ? 'Provisioning Router...' : 'Provision & Register Router'}</span>
          </button>
        )}
      </div>
    </section>
  );
}
