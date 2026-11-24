import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, KeyRound, RefreshCw, Terminal, X } from 'lucide-react';
import type { RouterDevice, Site } from '../../../packages/shared/types';
import { apiRequest } from '../../services/api';
import {
  generateFleetAutoProvisionScript,
  generateRouterAutoScript,
} from '../../utils/routerScripts';
import { StatusText } from '../ui/StatusText';

interface RouterAutoScriptPanelProps {
  token: string;
  routers: RouterDevice[];
  sites: Site[];
  initialRouterId?: string;
  onClose: () => void;
  notify: (msg: string) => void;
}

type ScriptSectionTab =
  | 'full'
  | 'wireguard'
  | 'bridge'
  | 'hotspot'
  | 'captive'
  | 'keepalive'
  | 'wgQuick'
  | 'serverPeer';

interface ProvisionTokenResponse {
  token: string;
  expiresAt: string;
  filename: string;
  fetchUrl: string;
  oneLineCommand: string;
}

export function RouterAutoScriptPanel({
  token,
  routers,
  sites,
  initialRouterId = 'all',
  onClose,
  notify,
}: RouterAutoScriptPanelProps) {
  const [selectedTarget, setSelectedTarget] = useState<string>(initialRouterId || 'all');
  const [sectionTab, setSectionTab] = useState<ScriptSectionTab>('full');
  const [wgEndpoint, setWgEndpoint] = useState('vpn.xcloud.co.tz:51820');
  const [wgPublicKey, setWgPublicKey] = useState('');
  const [wgClientPrivKey, setWgClientPrivKey] = useState('');
  const [wgClientPubKey, setWgClientPubKey] = useState('');
  const [wgPsk, setWgPsk] = useState('');
  const [generatingWg, setGeneratingWg] = useState(false);
  const [radiusSecret, setRadiusSecret] = useState('');
  const [bridgePortsOverride, setBridgePortsOverride] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [mintingOneLiner, setMintingOneLiner] = useState(false);
  const [oneLinerResult, setOneLinerResult] = useState<ProvisionTokenResponse | null>(null);
  const [mintError, setMintError] = useState('');

  const [batchCommands, setBatchCommands] = useState<
    { routerId: string; routerName: string; vendor: string; oneLineCommand: string; expiresAt: string }[]
  >([]);
  const [mintingBatch, setMintingBatch] = useState(false);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://portal.xcloud.co.tz';

  const siteMap = useMemo(() => {
    const map = new Map<string, Site>();
    for (const s of sites) map.set(s.id, s);
    return map;
  }, [sites]);

  const activeRouter = useMemo(
    () => (selectedTarget === 'all' ? null : routers.find((r) => r.id === selectedTarget) || null),
    [routers, selectedTarget]
  );

  const singleScript = useMemo(() => {
    if (!activeRouter) return null;
    const site = siteMap.get(activeRouter.siteId);
    const defaultPorts =
      activeRouter.vendor === 'MikroTik' ? 'ether2,ether3,ether4,wlan1' : 'LAN1,LAN2,WLAN-Hotspot';
    return generateRouterAutoScript({
      vendor: activeRouter.vendor,
      routerName: activeRouter.name,
      model: activeRouter.model,
      site,
      wanHost: activeRouter.ipAddress,
      apiPort: activeRouter.apiPort,
      apiUsername: 'xcloud-api',
      wireguardTunnelIp: activeRouter.wireguardTunnelIp,
      wireguardEndpoint: wgEndpoint,
      wireguardPublicKey: wgPublicKey,
      wireguardClientPrivateKey: wgClientPrivKey || undefined,
      wireguardClientPublicKey: wgClientPubKey || activeRouter.wireguardPublicKey,
      wireguardPresharedKey: wgPsk || undefined,
      radiusSecret,
      bridgeName: activeRouter.bridgeName || 'bridge-hotspot',
      bridgePorts: bridgePortsOverride.trim() || defaultPorts,
      hotspotSubnet: activeRouter.hotspotSubnet || '10.5.50.0/24',
      captivePortalOrigin: origin,
    });
  }, [activeRouter, bridgePortsOverride, origin, radiusSecret, siteMap, wgClientPrivKey, wgClientPubKey, wgEndpoint, wgPsk, wgPublicKey]);

  const fleetScript = useMemo(() => {
    return generateFleetAutoProvisionScript({
      routers,
      sites,
      captivePortalOrigin: origin,
      wireguardEndpoint: wgEndpoint,
      wireguardPublicKey: wgPublicKey,
      radiusSecret,
    });
  }, [origin, radiusSecret, routers, sites, wgEndpoint, wgPublicKey]);

  const activeText = useMemo(() => {
    if (!activeRouter || !singleScript) return fleetScript.fullScript;
    switch (sectionTab) {
      case 'wireguard':
        return singleScript.wireguard;
      case 'bridge':
        return singleScript.bridge;
      case 'hotspot':
        return singleScript.hotspot;
      case 'captive':
        return singleScript.captivePortal;
      case 'keepalive':
        return singleScript.keepalive;
      case 'wgQuick':
        return singleScript.wgQuickConf;
      case 'serverPeer':
        return singleScript.serverPeerConfig;
      default:
        return singleScript.fullScript;
    }
  }, [activeRouter, fleetScript.fullScript, sectionTab, singleScript]);

  const activeFilename = activeRouter && singleScript ? singleScript.filename : fleetScript.filename;

  const copyText = (text: string, key: string, label: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    notify(`${label} copied to clipboard.`);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const downloadActiveScript = () => {
    const content = activeRouter && singleScript ? singleScript.fullScript : fleetScript.fullScript;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify(`Downloaded ${activeFilename}`);
  };

  const mintSingleOneLiner = async () => {
    if (!activeRouter) return;
    setMintError('');
    setMintingOneLiner(true);
    try {
      const res = await apiRequest<ProvisionTokenResponse>(
        `/api/routers/${activeRouter.id}/provision-token`,
        {
          method: 'POST',
          token,
          body: {
            origin,
            wireguardEndpoint: wgEndpoint.trim(),
            serverPublicKey: wgPublicKey.trim() || undefined,
            clientPrivateKey: wgClientPrivKey || undefined,
            clientPublicKey: wgClientPubKey || activeRouter.wireguardPublicKey,
            presharedKey: wgPsk || undefined,
            bridgePorts: bridgePortsOverride.trim() || undefined,
          },
        }
      );
      setOneLinerResult(res);
      notify(`Generated 30-minute bootstrap command for ${activeRouter.name}.`);
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'Unable to generate bootstrap command.');
    } finally {
      setMintingOneLiner(false);
    }
  };

  const generateFreshWgKeys = async () => {
    setGeneratingWg(true);
    try {
      const res = await apiRequest<{
        clientPrivateKey: string;
        clientPublicKey: string;
        presharedKey: string;
        serverPublicKey: string;
        serverEndpoint: string;
      }>('/api/routers/wireguard/generate', {
        method: 'POST',
        token,
      });
      setWgEndpoint(res.serverEndpoint);
      setWgPublicKey(res.serverPublicKey);
      setWgClientPrivKey(res.clientPrivateKey);
      setWgClientPubKey(res.clientPublicKey);
      setWgPsk(res.presharedKey);
      notify('Generated fresh WireGuard X25519 keypair & PresharedKey.');
    } finally {
      setGeneratingWg(false);
    }
  };

  const mintAllFleetOneLiners = async () => {
    if (routers.length === 0) return;
    setMintError('');
    setMintingBatch(true);
    try {
      const results = await Promise.all(
        routers.map(async (r) => {
          const res = await apiRequest<ProvisionTokenResponse>(
            `/api/routers/${r.id}/provision-token`,
            {
              method: 'POST',
              token,
              body: {
                origin,
                wireguardEndpoint: wgEndpoint.trim(),
              },
            }
          );
          return {
            routerId: r.id,
            routerName: r.name,
            vendor: r.vendor,
            oneLineCommand: res.oneLineCommand,
            expiresAt: res.expiresAt,
          };
        })
      );
      setBatchCommands(results);
      notify(`Generated one-line auto-provision commands for ${results.length} router(s).`);
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'Unable to generate fleet bootstrap commands.');
    } finally {
      setMintingBatch(false);
    }
  };

  return (
    <section
      aria-label="MikroTik and Omada Auto-Provision All Script Console"
      className="border border-slate-300 bg-white rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <FileCode2 className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-slate-900">
              Auto-Provision All Script · MikroTik &amp; TP-Link Omada
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Complete WireGuard VPN, Bridge &amp; DHCP, Hotspot &amp; FreeRADIUS, CoA (3799), Captive Portal redirect, and keepalive scripts.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer shrink-0"
          aria-label="Close auto-provision script panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Controls */}
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Target Hardware Scope</label>
            <select
              value={selectedTarget}
              onChange={(e) => {
                setSelectedTarget(e.target.value);
                setOneLinerResult(null);
                setMintError('');
                setSectionTab('full');
              }}
              className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-md bg-white"
            >
              <option value="all">
                All Registered Routers ({routers.length} devices)
              </option>
              {routers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.vendor} ({r.siteName})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">WireGuard Endpoint</label>
            <input
              value={wgEndpoint}
              onChange={(e) => setWgEndpoint(e.target.value)}
              placeholder="vpn.xcloud.co.tz:51820"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Server WG Public Key (Optional)
            </label>
            <input
              value={wgPublicKey}
              onChange={(e) => setWgPublicKey(e.target.value)}
              placeholder="<XCLOUD_SERVER_WG_PUBLIC_KEY>"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              RADIUS Secret (Optional Override)
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={radiusSecret}
              onChange={(e) => setRadiusSecret(e.target.value)}
              placeholder="<SET_RADIUS_SHARED_SECRET>"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
          </div>
        </div>

        {activeRouter && (
          <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-y border-slate-200 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-600">
              <span className="font-mono font-semibold text-slate-900">{activeRouter.name}</span>
              <span aria-hidden="true">·</span>
              <span>{activeRouter.vendor}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{activeRouter.wireguardTunnelIp}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {activeRouter.bridgeName || 'bridge-hotspot'} ({activeRouter.hotspotSubnet || '10.5.50.0/24'})
              </span>
              <span aria-hidden="true">·</span>
              <StatusText status={activeRouter.status} />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={generatingWg}
                onClick={generateFreshWgKeys}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap"
              >
                <KeyRound className={`w-3.5 h-3.5 text-blue-700 ${generatingWg ? 'animate-spin' : ''}`} />
                <span>{generatingWg ? 'Generating...' : 'Generate WG Keys'}</span>
              </button>
              <label className="text-slate-600 font-medium">Ports:</label>
              <input
                value={bridgePortsOverride}
                onChange={(e) => setBridgePortsOverride(e.target.value)}
                placeholder={activeRouter.vendor === 'MikroTik' ? 'ether2,ether3,ether4,wlan1' : 'LAN1,LAN2,WLAN-Hotspot'}
                className="px-2.5 py-1 text-xs font-mono border border-slate-300 rounded-md w-48"
              />
            </div>
          </div>
        )}

        {/* Action Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {activeRouter ? (
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
                  onClick={() => setSectionTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    sectionTab === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-600">
              Combined bundle: <span className="font-mono font-semibold text-slate-900">{fleetScript.mikrotikCount} MikroTik</span> ·{' '}
              <span className="font-mono font-semibold text-slate-900">{fleetScript.omadaCount} TP-Link Omada</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {activeRouter ? (
              <button
                type="button"
                disabled={mintingOneLiner}
                onClick={mintSingleOneLiner}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap shrink-0"
              >
                <Terminal className={`w-3.5 h-3.5 text-blue-700 ${mintingOneLiner ? 'animate-spin' : ''}`} />
                <span>{mintingOneLiner ? 'Generating...' : 'One-Line Terminal Command'}</span>
              </button>
            ) : (
              routers.length > 0 && (
                <button
                  type="button"
                  disabled={mintingBatch}
                  onClick={mintAllFleetOneLiners}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-blue-700 ${mintingBatch ? 'animate-spin' : ''}`} />
                  <span>{mintingBatch ? 'Minting Commands...' : 'Generate All One-Line Commands'}</span>
                </button>
              )
            )}

            <button
              type="button"
              onClick={() => copyText(activeText, 'main-script', 'Auto-Provision script')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedKey === 'main-script' ? (
                <Check className="w-3.5 h-3.5 text-emerald-700" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedKey === 'main-script' ? 'Copied' : 'Copy Script'}</span>
            </button>

            <button
              type="button"
              onClick={downloadActiveScript}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download {activeFilename}</span>
            </button>
          </div>
        </div>

        {mintError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            {mintError}
          </div>
        )}

        {/* Single Router One-Line Bootstrap Output */}
        {activeRouter && oneLinerResult && (
          <div className="border border-blue-200 bg-blue-50/50 rounded-md p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-900">
                Paste into {activeRouter.vendor === 'MikroTik' ? 'MikroTik Winbox / SSH Terminal' : 'Omada Management Shell'}
              </span>
              <span className="font-mono text-slate-500 tabular-nums">
                Expires {new Date(oneLinerResult.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 bg-slate-950 text-slate-100 rounded-md px-3 py-2.5">
              <code className="font-mono text-[11px] overflow-x-auto whitespace-nowrap">
                {oneLinerResult.oneLineCommand}
              </code>
              <button
                type="button"
                onClick={() => copyText(oneLinerResult.oneLineCommand, 'one-liner', 'One-line command')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 hover:text-white cursor-pointer shrink-0 ml-2"
              >
                {copiedKey === 'one-liner' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'one-liner' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Fleet Batch One-Line Commands */}
        {!activeRouter && batchCommands.length > 0 && (
          <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
            <div className="px-4 py-2.5 bg-slate-50 flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>Per-Router One-Line Terminal Commands (30m TTL)</span>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    batchCommands.map((b) => `# ${b.routerName} (${b.vendor})\n${b.oneLineCommand}`).join('\n\n'),
                    'all-one-liners',
                    'All one-line commands'
                  )
                }
                className="text-blue-700 hover:underline cursor-pointer"
              >
                {copiedKey === 'all-one-liners' ? 'Copied All' : 'Copy All Commands'}
              </button>
            </div>
            {batchCommands.map((item) => (
              <div key={item.routerId} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold text-slate-900">
                    {item.routerName} · <span className="font-sans font-normal text-slate-500">{item.vendor}</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-600 truncate mt-0.5">{item.oneLineCommand}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copyText(item.oneLineCommand, item.routerId, `${item.routerName} command`)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline cursor-pointer shrink-0"
                >
                  {copiedKey === item.routerId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === item.routerId ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Script Code Viewer */}
        <pre className="bg-slate-950 text-slate-100 rounded-md p-4 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-96">
          {activeText}
        </pre>
      </div>
    </section>
  );
}
