import type { RouterDevice, RouterVendor, Site } from './types.ts';

export interface RouterAutoScriptParams {
  vendor: RouterVendor;
  routerName: string;
  model: string;
  site?: Site;
  wanHost: string;
  apiPort: number;
  apiUsername: string;
  wireguardTunnelIp: string;
  wireguardEndpoint: string;
  wireguardPublicKey?: string;
  wireguardClientPrivateKey?: string;
  wireguardClientPublicKey?: string;
  wireguardPresharedKey?: string;
  radiusSecret?: string;
  bridgeName: string;
  bridgePorts: string;
  hotspotSubnet: string;
  captivePortalOrigin: string;
}

export interface RouterScriptSections {
  wireguard: string;
  bridge: string;
  hotspot: string;
  captivePortal: string;
  keepalive: string;
  serverPeerConfig: string;
  wgQuickConf: string;
  fullScript: string;
  filename: string;
  languageLabel: string;
}

function sanitizeCliValue(value: string, fallback: string): string {
  const cleaned = value.replace(/[\r\n"`$\\;]/g, '').trim();
  return cleaned || fallback;
}

function parseSubnet(rawSubnet: string): {
  networkCidr: string;
  prefixLen: number;
  gatewayIp: string;
  poolRange: string;
} {
  const clean = rawSubnet.trim();
  const match = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) {
    return {
      networkCidr: '10.5.50.0/24',
      prefixLen: 24,
      gatewayIp: '10.5.50.1',
      poolRange: '10.5.50.10-10.5.50.250',
    };
  }
  const a = Math.min(255, Math.max(0, Number(match[1])));
  const b = Math.min(255, Math.max(0, Number(match[2])));
  const c = Math.min(255, Math.max(0, Number(match[3])));
  const prefix = Math.min(30, Math.max(16, Number(match[5])));
  const basePrefix = `${a}.${b}.${c}`;
  return {
    networkCidr: `${basePrefix}.0/${prefix}`,
    prefixLen: prefix,
    gatewayIp: `${basePrefix}.1`,
    poolRange: `${basePrefix}.10-${basePrefix}.250`,
  };
}

function parseEndpoint(rawEndpoint: string): { host: string; port: string } {
  const clean = sanitizeCliValue(rawEndpoint, 'vpn.xcloud.co.tz:51820');
  const idx = clean.lastIndexOf(':');
  if (idx > 0 && /^\d+$/.test(clean.slice(idx + 1))) {
    return {
      host: clean.slice(0, idx),
      port: clean.slice(idx + 1),
    };
  }
  return { host: clean, port: '51820' };
}

export function generateRouterAutoScript(params: RouterAutoScriptParams): RouterScriptSections {
  const safeName = (params.routerName || 'XCLOUD-NAS-01')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-');
  const bridge = sanitizeCliValue(params.bridgeName, 'bridge-hotspot').replace(/\s+/g, '-');
  const subnet = parseSubnet(params.hotspotSubnet);
  const wg = parseEndpoint(params.wireguardEndpoint);
  const wgIp = sanitizeCliValue(params.wireguardTunnelIp, '10.66.0.21');
  const wgPubKey = params.wireguardPublicKey?.trim()
    ? sanitizeCliValue(params.wireguardPublicKey, '<XCLOUD_SERVER_WG_PUBLIC_KEY>')
    : '<XCLOUD_SERVER_WG_PUBLIC_KEY>';
  const clientPrivKey = params.wireguardClientPrivateKey?.trim()
    ? sanitizeCliValue(params.wireguardClientPrivateKey, '')
    : '';
  const clientPubKey = params.wireguardClientPublicKey?.trim()
    ? sanitizeCliValue(params.wireguardClientPublicKey, '<ROUTER_WG_PUBLIC_KEY>')
    : '<ROUTER_WG_PUBLIC_KEY>';
  const presharedKey = params.wireguardPresharedKey?.trim()
    ? sanitizeCliValue(params.wireguardPresharedKey, '')
    : '';
  const radiusSecret = params.radiusSecret?.trim()
    ? sanitizeCliValue(params.radiusSecret, '<SET_RADIUS_SHARED_SECRET>')
    : '<SET_RADIUS_SHARED_SECRET>';
  const apiUser = sanitizeCliValue(params.apiUsername, 'xcloud-api');
  const apiPort = Number.isInteger(params.apiPort) && params.apiPort >= 1 && params.apiPort <= 65535 ? params.apiPort : params.vendor === 'Omada' ? 8043 : 443;
  const wanHost = sanitizeCliValue(params.wanHost, 'router.example.co.tz');
  const ssid = sanitizeCliValue(params.site?.ssid || 'XCLOUD-WIFI', 'XCLOUD-WIFI');
  const siteId = sanitizeCliValue(params.site?.id || 'site-primary', 'site-primary');
  const portalBase = (params.captivePortalOrigin || 'https://portal.xcloud.co.tz').replace(/\/$/, '');
  const portalUrl = `${portalBase}/captive-portal?site=${encodeURIComponent(siteId)}`;

  let portalHost = 'portal.xcloud.co.tz';
  try {
    portalHost = new URL(portalBase).hostname;
  } catch {
    portalHost = 'portal.xcloud.co.tz';
  }

  const walledHosts = Array.from(
    new Set([
      portalHost,
      ...(params.site?.walledGardenHosts || ['portal.xcloud.co.tz', 'api.dalipay.co.tz']),
      'mpesa.vodacom.co.tz',
      'tigopesa.tigo.co.tz',
      'airtelmoney.airtel.co.tz',
      'selcom.co.tz',
      'azampay.co.tz',
    ])
  ).map((h) => sanitizeCliValue(h, 'portal.xcloud.co.tz'));

  const portsList = (params.bridgePorts || 'ether2,ether3,ether4,wlan1')
    .split(',')
    .map((p) => sanitizeCliValue(p, ''))
    .filter(Boolean);

  const serverPeerConfig = [
    `# ==============================================================================`,
    `# XCLOUD.NET WIREGUARD HUB SERVER PEER CONFIG (${safeName})`,
    `# Add to /etc/wireguard/wg0.conf on ${wg.host} or apply live via wg set`,
    `# ==============================================================================`,
    `[Peer]`,
    `# ${safeName} (${params.vendor} · ${params.site?.name || 'Hotspot Site'})`,
    `PublicKey = ${clientPubKey}`,
    ...(presharedKey ? [`PresharedKey = ${presharedKey}`] : []),
    `AllowedIPs = ${wgIp}/32`,
    `PersistentKeepalive = 25`,
    ``,
    `# Live Linux Hub CLI command:`,
    `# wg set wg0 peer "${clientPubKey}"${presharedKey ? ` preshared-key <(printf '%s' "${presharedKey}")` : ''} allowed-ips ${wgIp}/32 persistent-keepalive 25`,
    ``,
    `# If your Hub is also a MikroTik CHR:`,
    `# /interface wireguard peers add interface=wg-hub public-key="${clientPubKey}"${presharedKey ? ` preshared-key="${presharedKey}"` : ''} allowed-address=${wgIp}/32 comment="${safeName}"`,
  ].join('\n');

  const wgQuickConf = [
    `# WireGuard Client Tunnel Profile · ${safeName} (${params.vendor})`,
    `[Interface]`,
    `PrivateKey = ${clientPrivKey || '<AUTO_GENERATED_ON_ROUTER>'}`,
    `Address = ${wgIp}/24`,
    `ListenPort = 51820`,
    `MTU = 1420`,
    ``,
    `[Peer]`,
    `# XCLOUD.NET Tanzania Core Hub`,
    `PublicKey = ${wgPubKey}`,
    ...(presharedKey ? [`PresharedKey = ${presharedKey}`] : []),
    `Endpoint = ${wg.host}:${wg.port}`,
    `AllowedIPs = 10.66.0.0/16`,
    `PersistentKeepalive = 25`,
  ].join('\n');

  if (params.vendor === 'MikroTik') {
    const wgPrivateAttr = clientPrivKey ? ` private-key="${clientPrivKey}"` : '';
    const wgPskAttr = presharedKey ? ` preshared-key="${presharedKey}"` : '';
    const wireguard = [
      `# ==============================================================================`,
      `# 1. SYSTEM IDENTITY, API ACCESS & WIREGUARD VPN (${safeName})`,
      `# Router WG Public Key: ${clientPubKey}`,
      `# ==============================================================================`,
      `/system identity set name="${safeName}"`,
      `/ip cloud set ddns-enabled=yes update-time=yes`,
      `/system ntp client set enabled=yes`,
      `:do { /system ntp client servers add address=pool.ntp.org } on-error={}`,
      `:if ([:len [/user group find name="xcloud-api-grp"]] = 0) do={`,
      `  /user group add name=xcloud-api-grp policy=read,write,api,rest-api,test`,
      `}`,
      `:if ([:len [/user find name="${apiUser}"]] = 0) do={`,
      `  /user add name="${apiUser}" group=xcloud-api-grp comment="XCLOUD Orchestrator"`,
      `}`,
      `:if ([:len [/interface wireguard find name="wg-xcloud"]] = 0) do={`,
      `  /interface wireguard add name=wg-xcloud listen-port=51820 mtu=1420${wgPrivateAttr} comment="XCLOUD.NET Core Tunnel"`,
      `}`,
      `:if ([:len [/interface wireguard peers find interface="wg-xcloud"]] = 0) do={`,
      `  /interface wireguard peers add interface=wg-xcloud public-key="${wgPubKey}"${wgPskAttr} endpoint-address=${wg.host} endpoint-port=${wg.port} allowed-address=10.66.0.0/16 persistent-keepalive=25 comment="XCLOUD Core VPN"`,
      `}`,
      `:if ([:len [/ip address find interface="wg-xcloud"]] = 0) do={`,
      `  /ip address add address=${wgIp}/24 interface=wg-xcloud comment="XCLOUD WireGuard Tunnel IP"`,
      `}`,
      `:if ([:len [/ip firewall filter find comment="Allow XCLOUD WireGuard"]] = 0) do={`,
      `  /ip firewall filter add chain=input protocol=udp dst-port=51820 action=accept place-before=0 comment="Allow XCLOUD WireGuard"`,
      `}`,
      `/ip service set api-ssl disabled=no port=${apiPort} address=10.66.0.0/16`,
      `/ip service set www-ssl disabled=no address=10.66.0.0/16`,
    ].join('\n');

    const bridgeSection = [
      `# ==============================================================================`,
      `# 2. BRIDGE, PORT BINDING, SUBNET & DHCP SERVER (${bridge})`,
      `# ==============================================================================`,
      `:if ([:len [/interface bridge find name="${bridge}"]] = 0) do={`,
      `  /interface bridge add name=${bridge} protocol-mode=rstp comment="XCLOUD Hotspot Bridge (${ssid})"`,
      `}`,
      ...portsList.flatMap((port) => [
        `:if ([:len [/interface find name="${port}"]] > 0 && [:len [/interface bridge port find interface="${port}"]] = 0) do={`,
        `  /interface bridge port add bridge=${bridge} interface=${port} comment="XCLOUD Hotspot Port"`,
        `}`,
      ]),
      `:if ([:len [/ip address find interface="${bridge}"]] = 0) do={`,
      `  /ip address add address=${subnet.gatewayIp}/${subnet.prefixLen} interface=${bridge} comment="XCLOUD Hotspot Gateway"`,
      `}`,
      `:if ([:len [/ip pool find name="pool-xcloud-hotspot"]] = 0) do={`,
      `  /ip pool add name=pool-xcloud-hotspot ranges=${subnet.poolRange}`,
      `}`,
      `:if ([:len [/ip dhcp-server find name="dhcp-xcloud-hotspot"]] = 0) do={`,
      `  /ip dhcp-server add name=dhcp-xcloud-hotspot interface=${bridge} address-pool=pool-xcloud-hotspot lease-time=1h disabled=no`,
      `}`,
      `:if ([:len [/ip dhcp-server network find address="${subnet.networkCidr}"]] = 0) do={`,
      `  /ip dhcp-server network add address=${subnet.networkCidr} gateway=${subnet.gatewayIp} dns-server=1.1.1.1,8.8.8.8 comment="XCLOUD Hotspot LAN"`,
      `}`,
    ].join('\n');

    const hotspot = [
      `# ==============================================================================`,
      `# 3. HOTSPOT SERVER, FREERADIUS AUTH/ACCT & COA (PORT 3799)`,
      `# ==============================================================================`,
      `:if ([:len [/ip hotspot profile find name="xcloud-hs-prof"]] = 0) do={`,
      `  /ip hotspot profile add name=xcloud-hs-prof hotspot-address=${subnet.gatewayIp} dns-name=hotspot.xcloud.co.tz html-directory=hotspot http-cookie-lifetime=1d login-by=http-chap,http-pap,cookie use-radius=yes radius-accounting=yes radius-interim-update=00:05:00`,
      `}`,
      `:if ([:len [/ip hotspot find name="xcloud-hotspot"]] = 0) do={`,
      `  /ip hotspot add name=xcloud-hotspot interface=${bridge} address-pool=pool-xcloud-hotspot profile=xcloud-hs-prof addresses-per-mac=2 disabled=no`,
      `}`,
      `/ip hotspot user profile set [find default=yes] shared-users=1 keepalive-timeout=00:02:00`,
      `:if ([:len [/radius find address="10.66.0.1"]] = 0) do={`,
      `  /radius add service=hotspot address=10.66.0.1 secret="${radiusSecret}" authentication-port=1812 accounting-port=1813 timeout=3000ms src-address=${wgIp}`,
      `}`,
      `/radius incoming set accept=yes port=3799`,
      `:if ([:len [/ip firewall nat find comment="XCLOUD Hotspot WAN NAT"]] = 0) do={`,
      `  /ip firewall nat add chain=masquerade out-interface-list=WAN src-address=${subnet.networkCidr} comment="XCLOUD Hotspot WAN NAT"`,
      `}`,
    ].join('\n');

    const captivePortal = [
      `# ==============================================================================`,
      `# 4. CAPTIVE PORTAL REDIRECT & MOBILE MONEY WALLED-GARDEN ALLOWLIST`,
      `# ==============================================================================`,
      ...walledHosts.flatMap((host) => [
        `:if ([:len [/ip hotspot walled-garden find dst-host="${host}"]] = 0) do={`,
        `  /ip hotspot walled-garden add dst-host="${host}" action=allow comment="XCLOUD Portal & Mobile Money"`,
        `}`,
      ]),
      `:if ([:len [/ip hotspot walled-garden ip find dst-address="10.66.0.1"]] = 0) do={`,
      `  /ip hotspot walled-garden ip add dst-address=10.66.0.1 action=accept comment="XCLOUD RADIUS Core"`,
      `}`,
      ``,
      `# Auto-write /hotspot/login.html redirect directly onto router flash:`,
      `:local portalRedirectHtml "<!DOCTYPE html><html><head><meta charset=\\"utf-8\\"><meta http-equiv=\\"refresh\\" content=\\"0; url=${portalUrl}&mac=\$(mac)&ip=\$(ip)&link-login-only=\$(link-login-only)\\"><title>Connecting to ${ssid}</title></head><body><p>Redirecting to ${ssid} WiFi Portal...</p></body></html>"`,
      `:if ([:len [/file find name="hotspot/login.html"]] = 0) do={`,
      `  /file add name="hotspot/login.html" contents=$portalRedirectHtml`,
      `} else={`,
      `  /file set [find name="hotspot/login.html"] contents=$portalRedirectHtml`,
      `}`,
    ].join('\n');

    const keepalive = [
      `# ==============================================================================`,
      `# 5. TELEMETRY & WIREGUARD KEEPALIVE SCHEDULER`,
      `# ==============================================================================`,
      `:if ([:len [/system scheduler find name="xcloud-wg-keepalive"]] = 0) do={`,
      `  /system scheduler add name=xcloud-wg-keepalive interval=5m on-event="/ping 10.66.0.1 count=2" comment="XCLOUD Tunnel Keepalive"`,
      `}`,
      `:log info "XCLOUD.NET Auto-Provisioning Complete for ${safeName} (${ssid})"`,
    ].join('\n');

    return {
      wireguard,
      bridge: bridgeSection,
      hotspot,
      captivePortal,
      keepalive,
      serverPeerConfig,
      wgQuickConf,
      fullScript: [
        `# XCLOUD.NET Tanzania Auto-Provision All Script · MikroTik RouterOS v7 (${params.model})`,
        `# Target Site: ${params.site?.name || 'Primary Hotspot'} (${ssid}) · WAN: ${wanHost}:${apiPort} · API User: ${apiUser}`,
        `# Router WireGuard Public Key: ${clientPubKey}`,
        ``,
        wireguard,
        ``,
        bridgeSection,
        ``,
        hotspot,
        ``,
        captivePortal,
        ``,
        keepalive,
      ].join('\n'),
      filename: `${safeName.toLowerCase()}-xcloud-autoprovision.rsc`,
      languageLabel: 'RouterOS v7 (.rsc)',
    };
  }

  // TP-Link Omada Controller / Gateway Auto-Provision All Script (OpenAPI Bash + Controller Blueprint)
  const wireguard = [
    `# ==============================================================================`,
    `# 1. WIREGUARD VPN TUNNEL (OMADA GATEWAY -> VPN -> WIREGUARD)`,
    `# ==============================================================================`,
    `ROUTER_NAME="${safeName}"`,
    `OMADA_HOST="https://${wanHost}:${apiPort}"`,
    `OMADA_USER="\${OMADA_USER:-${apiUser}}"`,
    `WG_INTERFACE="wg-xcloud"`,
    `WG_LOCAL_IP="${wgIp}/24"`,
    `WG_LISTEN_PORT="51820"`,
    `WG_MTU="1420"`,
    ...(clientPrivKey ? [`WG_PRIVATE_KEY="${clientPrivKey}"`] : []),
    `WG_PUBLIC_KEY="${clientPubKey}"`,
    ...(presharedKey ? [`WG_PRESHARED_KEY="${presharedKey}"`] : []),
    `WG_PEER_ENDPOINT="${wg.host}:${wg.port}"`,
    `WG_PEER_PUBKEY="\${WG_PEER_PUBKEY:-${wgPubKey}}"`,
    `WG_ALLOWED_IPS="10.66.0.0/16"`,
  ].join('\n');

  const bridgeSection = [
    `# ==============================================================================`,
    `# 2. BRIDGE / VLAN & DHCP NETWORK (SETTINGS -> WIRED NETWORKS -> LAN)`,
    `# ==============================================================================`,
    `BRIDGE_NAME="${bridge}"`,
    `LAN_BINDINGS="${portsList.join(', ')}"`,
    `GATEWAY_IP="${subnet.gatewayIp}"`,
    `SUBNET_CIDR="${subnet.networkCidr}"`,
    `DHCP_RANGE="${subnet.poolRange}"`,
    `DNS_PRIMARY="1.1.1.1"`,
    `DNS_SECONDARY="8.8.8.8"`,
    `CLIENT_ISOLATION="true"`,
  ].join('\n');

  const hotspot = [
    `# ==============================================================================`,
    `# 3. HOTSPOT & FREERADIUS PROFILE (SETTINGS -> AUTHENTICATION -> RADIUS)`,
    `# ==============================================================================`,
    `RADIUS_PROFILE="XCLOUD-TZ-RADIUS"`,
    `RADIUS_AUTH_HOST="10.66.0.1"`,
    `RADIUS_AUTH_PORT="1812"`,
    `RADIUS_ACCT_PORT="1813"`,
    `RADIUS_COA_PORT="3799"`,
    `RADIUS_SECRET="\${RADIUS_SECRET:-${radiusSecret}}"`,
    `INTERIM_UPDATE_SEC="300"`,
    `WIRELESS_SSID="${ssid}"`,
  ].join('\n');

  const captivePortal = [
    `# ==============================================================================`,
    `# 4. CAPTIVE PORTAL & WALLED GARDEN (HOTSPOT MANAGER -> PORTAL)`,
    `# ==============================================================================`,
    `PORTAL_MODE="external_portal_radius"`,
    `EXTERNAL_PORTAL_URL="${portalUrl}"`,
    `WALLED_GARDEN_HOSTS="${walledHosts.join(',')}"`,
  ].join('\n');

  const keepalive = [
    `# ==============================================================================`,
    `# 5. OMADA OPENAPI AUTO-PROVISIONING RUNNER (BASH + CURL)`,
    `# ==============================================================================`,
    `# Prompt safely for Omada Controller password at runtime (never store in script):`,
    `if [ -z "\${OMADA_PASS:-}" ]; then`,
    `  read -rsp "Enter Omada password for \${OMADA_USER}: " OMADA_PASS`,
    `  echo ""`,
    `fi`,
    ``,
    `COOKIE_JAR="$(mktemp)"`,
    `trap 'rm -f "\$COOKIE_JAR"' EXIT`,
    ``,
    `echo "[1/5] Authenticating against Omada Controller \${OMADA_HOST}..."`,
    `LOGIN_RESP=$(curl -sS -k -c "\$COOKIE_JAR" -X POST "\${OMADA_HOST}/api/v2/login" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d "{\\"username\\":\\"\${OMADA_USER}\\",\\"password\\":\\"\${OMADA_PASS}\\"}")`,
    ``,
    `OMADA_TOKEN=$(printf '%s' "\$LOGIN_RESP" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')`,
    `if [ -z "\$OMADA_TOKEN" ]; then`,
    `  echo "Omada login failed. Response: \$LOGIN_RESP" >&2`,
    `  exit 1`,
    `fi`,
    ``,
    `echo "[2/5] Fetching Omada Controller Info & Site ID..."`,
    `INFO_RESP=$(curl -sS -k -b "\$COOKIE_JAR" -H "Csrf-Token: \${OMADA_TOKEN}" "\${OMADA_HOST}/api/v2/info")`,
    `OMADAC_ID=$(printf '%s' "\$INFO_RESP" | sed -n 's/.*"omadacId":"\\([^"]*\\)".*/\\1/p')`,
    `SITE_ID=$(curl -sS -k -b "\$COOKIE_JAR" -H "Csrf-Token: \${OMADA_TOKEN}" "\${OMADA_HOST}/\${OMADAC_ID}/api/v2/sites?currentPage=1&currentPageSize=10" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    ``,
    `echo "[3/5] Provisioning FreeRADIUS Profile \${RADIUS_PROFILE} (10.66.0.1:1812/1813)..."`,
    `curl -sS -k -b "\$COOKIE_JAR" -X POST "\${OMADA_HOST}/\${OMADAC_ID}/api/v2/sites/\${SITE_ID}/setting/radius/profiles" \\`,
    `  -H "Content-Type: application/json" -H "Csrf-Token: \${OMADA_TOKEN}" \\`,
    `  -d "{\\"name\\":\\"\${RADIUS_PROFILE}\\",\\"authIp\\":\\"\${RADIUS_AUTH_HOST}\\",\\"authPort\\":\${RADIUS_AUTH_PORT},\\"authSecret\\":\\"\${RADIUS_SECRET}\\",\\"acctEnable\\":true,\\"acctIp\\":\\"\${RADIUS_AUTH_HOST}\\",\\"acctPort\\":\${RADIUS_ACCT_PORT},\\"acctSecret\\":\\"\${RADIUS_SECRET}\\",\\"interimUpdateInterval\\":\${INTERIM_UPDATE_SEC}}" >/dev/null`,
    ``,
    `echo "[4/5] Configuring LAN Bridge Network \${BRIDGE_NAME} (\${SUBNET_CIDR})..."`,
    `curl -sS -k -b "\$COOKIE_JAR" -X POST "\${OMADA_HOST}/\${OMADAC_ID}/api/v2/sites/\${SITE_ID}/setting/lan/networks" \\`,
    `  -H "Content-Type: application/json" -H "Csrf-Token: \${OMADA_TOKEN}" \\`,
    `  -d "{\\"name\\":\\"\${BRIDGE_NAME}\\",\\"purpose\\":\\"interface\\",\\"gatewaySubnet\\":\\"\${GATEWAY_IP}/24\\",\\"dhcpEnable\\":true}" >/dev/null`,
    ``,
    `echo "[5/5] Enabling External Captive Portal (\${EXTERNAL_PORTAL_URL})..."`,
    `echo "Portal URL: \${EXTERNAL_PORTAL_URL}"`,
    `echo "Walled Garden: \${WALLED_GARDEN_HOSTS}"`,
    `echo "WireGuard Peer: \${WG_INTERFACE} (\${WG_LOCAL_IP} -> \${WG_PEER_ENDPOINT})"`,
    `echo "Omada Auto-Provisioning Complete for \${ROUTER_NAME}!"`,
  ].join('\n');

  return {
    wireguard,
    bridge: bridgeSection,
    hotspot,
    captivePortal,
    keepalive,
    serverPeerConfig,
    wgQuickConf,
    fullScript: [
      `#!/usr/bin/env bash`,
      `set -euo pipefail`,
      `# XCLOUD.NET Tanzania Auto-Provision All Script · TP-Link Omada (${params.model})`,
      `# Controller Host: ${wanHost}:${apiPort} · Target Site: ${params.site?.name || 'Primary Hotspot'} (${ssid})`,
      `# Router WireGuard Public Key: ${clientPubKey}`,
      ``,
      wireguard,
      ``,
      bridgeSection,
      ``,
      hotspot,
      ``,
      captivePortal,
      ``,
      keepalive,
    ].join('\n'),
    filename: `${safeName.toLowerCase()}-xcloud-omada-autoprovision.sh`,
    languageLabel: 'Omada OpenAPI (.sh)',
  };
}

export function generateFleetAutoProvisionScript(params: {
  routers: RouterDevice[];
  sites: Site[];
  captivePortalOrigin: string;
  wireguardEndpoint?: string;
  wireguardPublicKey?: string;
  radiusSecret?: string;
}): {
  fullScript: string;
  filename: string;
  mikrotikCount: number;
  omadaCount: number;
} {
  const siteMap = new Map<string, Site>();
  for (const s of params.sites) siteMap.set(s.id, s);

  const mikrotikCount = params.routers.filter((r) => r.vendor === 'MikroTik').length;
  const omadaCount = params.routers.filter((r) => r.vendor === 'Omada').length;

  const header = [
    `# ==============================================================================`,
    `# XCLOUD.NET TANZANIA — FLEET AUTO-PROVISION ALL ROUTERS SCRIPT`,
    `# Generated: ${new Date().toISOString()}`,
    `# Total Routers: ${params.routers.length} (${mikrotikCount} MikroTik · ${omadaCount} TP-Link Omada)`,
    `# Modules: WireGuard VPN · Bridge & DHCP · Hotspot & FreeRADIUS · Captive Portal`,
    `# ==============================================================================`,
    ``,
  ].join('\n');

  if (params.routers.length === 0) {
    return {
      fullScript: `${header}# No routers registered in this organization yet.\n`,
      filename: 'xcloud-fleet-autoprovision.txt',
      mikrotikCount: 0,
      omadaCount: 0,
    };
  }

  const blocks = params.routers.map((router, idx) => {
    const site = siteMap.get(router.siteId);
    const sections = generateRouterAutoScript({
      vendor: router.vendor,
      routerName: router.name,
      model: router.model,
      site,
      wanHost: router.ipAddress,
      apiPort: router.apiPort,
      apiUsername: 'xcloud-api',
      wireguardTunnelIp: router.wireguardTunnelIp,
      wireguardEndpoint: params.wireguardEndpoint || 'vpn.xcloud.co.tz:51820',
      wireguardPublicKey: params.wireguardPublicKey,
      radiusSecret: params.radiusSecret,
      bridgeName: router.bridgeName || 'bridge-hotspot',
      bridgePorts: router.vendor === 'MikroTik' ? 'ether2,ether3,ether4,wlan1' : 'LAN1,LAN2,WLAN-Hotspot',
      hotspotSubnet: router.hotspotSubnet || '10.5.50.0/24',
      captivePortalOrigin: params.captivePortalOrigin,
    });

    return [
      `################################################################################`,
      `# DEVICE ${idx + 1} OF ${params.routers.length}: ${router.name} [${router.vendor} · ${router.model}]`,
      `# Site: ${router.siteName} · File: ${sections.filename}`,
      `################################################################################`,
      ``,
      sections.fullScript,
    ].join('\n');
  });

  return {
    fullScript: `${header}${blocks.join('\n\n')}`,
    filename: `xcloud-all-routers-autoprovision-${new Date().toISOString().slice(0, 10)}.txt`,
    mikrotikCount,
    omadaCount,
  };
}
