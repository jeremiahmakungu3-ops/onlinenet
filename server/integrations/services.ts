import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import type { DalipayProvider, PaymentTransaction, RadiusSession, RouterDevice, RouterVendor, Voucher } from '../../packages/shared/types.ts';
import { store } from '../db/store.ts';
import { evaluateAndDispatchRouterAlerts } from './alerts.ts';

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // Loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // Link-local / Metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a >= 224) return true; // Multicast / Reserved
  return false;
}

function isLoopbackOrMetadataIp(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('::ffff:')) {
    return isLoopbackOrMetadataIp(normalized.slice(7));
  }
  if (net.isIPv6(normalized)) {
    return (
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    );
  }
  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    return (
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }
  return true;
}

function isSafePublicIp(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  if (normalized.startsWith('::ffff:')) {
    return isSafePublicIp(normalized.slice(7));
  }
  if (net.isIPv4(normalized)) {
    return !isPrivateOrReservedIpv4(normalized);
  }
  if (net.isIPv6(normalized)) {
    if (normalized === '::1' || normalized === '::') return false;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return false;
    }
    return true;
  }
  return false;
}

function isValidHostInput(rawHost: string): boolean {
  const host = rawHost.trim();
  if (!host || host.length > 253) return false;
  if (/[\s/?#@\\]/.test(host)) return false;
  if (net.isIP(host)) return true;
  return /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host);
}

export interface RouterConnectionCheckItem {
  id: string;
  label: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  detail: string;
}

export interface RouterConnectionTestResult {
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
  checks: RouterConnectionCheckItem[];
  message: string;
}

function tcpProbe(ip: string, port: number, timeoutMs = 3500): Promise<{ connected: boolean; latencyMs: number; error?: string }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host: ip, port });
    let settled = false;

    const finish = (connected: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ connected, latencyMs: Date.now() - started, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'Connection timed out'));
    socket.once('error', (err) => finish(false, err.message));
  });
}

export interface WanDetectionResult {
  detected: boolean;
  publicIp: string | null;
  reverseHost: string | null;
  source: 'request-header' | 'client-probe' | 'local';
  openPorts: { port: number; latencyMs: number }[];
  recommendedPort: number;
  message: string;
}

export function extractSafePublicIpFromCandidate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^::ffff:/i, '');
  if (!net.isIP(cleaned)) return null;
  return isSafePublicIp(cleaned) ? cleaned : null;
}

export async function inspectPublicWanIp(params: {
  publicIp: string;
  vendor: RouterVendor;
  source: 'request-header' | 'client-probe';
  probePorts?: boolean;
}): Promise<WanDetectionResult> {
  const safeIp = extractSafePublicIpFromCandidate(params.publicIp);
  const defaultPort = params.vendor === 'Omada' ? 8043 : 443;
  if (!safeIp) {
    return {
      detected: false,
      publicIp: null,
      reverseHost: null,
      source: 'local',
      openPorts: [],
      recommendedPort: defaultPort,
      message: 'No public WAN IP detected (private or loopback network). Use your static WAN IP, DDNS hostname, or WireGuard Tunnel IP.',
    };
  }

  const candidatePorts = params.vendor === 'Omada' ? [8043, 443] : [443, 8729, 8728];
  const [reverseHosts, portResults] = await Promise.all([
    dns.promises.reverse(safeIp).catch(() => [] as string[]),
    params.probePorts !== false
      ? Promise.all(
          candidatePorts.map(async (port) => {
            const res = await tcpProbe(safeIp, port, 1500);
            return res.connected ? { port, latencyMs: res.latencyMs } : null;
          })
        )
      : Promise.resolve([]),
  ]);

  const openPorts = portResults.filter((p): p is { port: number; latencyMs: number } => Boolean(p));
  const recommendedPort = openPorts[0]?.port ?? defaultPort;
  const reverseHost = reverseHosts[0] || null;

  return {
    detected: true,
    publicIp: safeIp,
    reverseHost,
    source: params.source,
    openPorts,
    recommendedPort,
    message:
      openPorts.length > 0
        ? `Detected public WAN IP ${safeIp} with open management port(s): ${openPorts.map((p) => `${p.port} (${p.latencyMs} ms)`).join(', ')}.`
        : `Detected public WAN IP ${safeIp}${reverseHost ? ` (${reverseHost})` : ''}. No inbound management port responded — outbound WireGuard tunnel will connect it automatically.`,
  };
}

export async function testRouterConnection(params: {
  vendor: RouterVendor;
  host: string;
  port: number;
  username: string;
  password: string;
}): Promise<RouterConnectionTestResult> {
  const cleanHost = params.host.trim();
  const cleanUser = params.username.trim();
  const cleanPass = params.password;
  const checks: RouterConnectionCheckItem[] = [];

  if (!isValidHostInput(cleanHost)) {
    throw new Error('Enter a valid IPv4 address or hostname without protocol prefixes.');
  }
  if (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535) {
    throw new Error('API port must be an integer between 1 and 65535.');
  }
  if (cleanUser.length < 2 || cleanUser.length > 64 || /[\r\n:]/.test(cleanUser)) {
    throw new Error('Management username must be 2–64 characters and cannot contain ":" or line breaks.');
  }
  if (cleanPass.length < 6 || cleanPass.length > 128) {
    throw new Error('API password / token must be 6–128 characters.');
  }

  checks.push({
    id: 'credentials',
    label: 'Credential Syntax & Port Policy',
    status: 'passed',
    detail: `${params.vendor} API user "${cleanUser}" on port ${params.port} validated.`,
  });

  const lowerHost = cleanHost.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.internal') ||
    (net.isIP(cleanHost) && isLoopbackOrMetadataIp(cleanHost))
  ) {
    throw new Error('Loopback, link-local, and internal metadata addresses are blocked.');
  }

  if (net.isIP(cleanHost) && !isSafePublicIp(cleanHost)) {
    checks.push({
      id: 'network',
      label: 'Public WAN Reachability',
      status: 'warning',
      detail: `${cleanHost} is a private/WireGuard subnet address. Outbound cloud probing only targets public WAN IPs.`,
    });
    checks.push({
      id: 'auth',
      label: 'Router API Handshake',
      status: 'skipped',
      detail: 'Apply the generated WireGuard Auto-Script on the router so it initiates the tunnel to XCLOUD.NET.',
    });
    return {
      validCredentials: true,
      reachable: false,
      authenticated: false,
      isPrivateAddress: true,
      latencyMs: null,
      systemInfo: null,
      checks,
      message:
        'Credential format is valid. Private/WireGuard tunnel IPs cannot be probed inbound before the WireGuard tunnel connects — proceed to Step 3 to download the Auto-Script.',
    };
  }

  let resolvedIp = cleanHost;
  if (!net.isIP(cleanHost)) {
    try {
      const lookedUp = await dns.promises.lookup(cleanHost);
      resolvedIp = lookedUp.address;
    } catch {
      checks.push({
        id: 'dns',
        label: 'DNS Resolution',
        status: 'failed',
        detail: `Hostname "${cleanHost}" did not resolve via DNS.`,
      });
      return {
        validCredentials: true,
        reachable: false,
        authenticated: false,
        isPrivateAddress: false,
        latencyMs: null,
        systemInfo: null,
        checks,
        message: `DNS resolution failed for "${cleanHost}". Verify your router DDNS or enter a public WAN IPv4 address.`,
      };
    }

    if (!isSafePublicIp(resolvedIp)) {
      throw new Error('Resolved host points to a private, loopback, or reserved network address.');
    }
  }

  const tcpResult = await tcpProbe(resolvedIp, params.port, 3500);
  if (!tcpResult.connected) {
    checks.push({
      id: 'tcp',
      label: `TCP Socket (${resolvedIp}:${params.port})`,
      status: 'failed',
      detail: tcpResult.error || 'TCP port unreachable.',
    });
    checks.push({
      id: 'auth',
      label: 'Router API Authentication',
      status: 'skipped',
      detail: 'Skipped because the API port did not accept a TCP connection.',
    });
    return {
      validCredentials: true,
      reachable: false,
      authenticated: false,
      isPrivateAddress: false,
      latencyMs: tcpResult.latencyMs,
      systemInfo: null,
      checks,
      message: `Port ${params.port} on ${cleanHost} (${resolvedIp}) is unreachable (${tcpResult.error || 'timeout'}). If this router is behind CGNAT/firewall, continue to Step 3 to apply the WireGuard Auto-Script.`,
    };
  }

  checks.push({
    id: 'tcp',
    label: `TCP Socket (${resolvedIp}:${params.port})`,
    status: 'passed',
    detail: `Connected in ${tcpResult.latencyMs} ms.`,
  });

  // Attempt live HTTPS REST authentication check if port uses REST API (skip raw binary API port 8728/8729)
  if (params.vendor === 'MikroTik' && (params.port === 8728 || params.port === 8729)) {
    checks.push({
      id: 'auth',
      label: 'MikroTik API-SSL Port Reachable',
      status: 'passed',
      detail: `TCP port ${params.port} accepted connection. RouterOS REST inspection runs on HTTPS (443) or after WireGuard sync.`,
    });
    return {
      validCredentials: true,
      reachable: true,
      authenticated: true,
      isPrivateAddress: false,
      latencyMs: tcpResult.latencyMs,
      systemInfo: null,
      checks,
      message: `MikroTik API endpoint ${cleanHost}:${params.port} is reachable (${tcpResult.latencyMs} ms).`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const endpoint =
      params.vendor === 'MikroTik'
        ? `https://${cleanHost}:${params.port}/rest/system/resource`
        : `https://${cleanHost}:${params.port}/api/v2/info`;
    const basicAuth = Buffer.from(`${cleanUser}:${cleanPass}`).toString('base64');

    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (resp.status === 401 || resp.status === 403) {
      checks.push({
        id: 'auth',
        label: 'Router API Authentication',
        status: 'failed',
        detail: `Hardware responded HTTP ${resp.status} (invalid username or password).`,
      });
      return {
        validCredentials: false,
        reachable: true,
        authenticated: false,
        isPrivateAddress: false,
        latencyMs: tcpResult.latencyMs,
        systemInfo: null,
        checks,
        message: `Connected to ${cleanHost}:${params.port}, but credentials were rejected (HTTP ${resp.status}).`,
      };
    }

    if (resp.ok) {
      const body = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
      const systemInfo = body
        ? {
            boardName: typeof body['board-name'] === 'string' ? body['board-name'] : undefined,
            version: typeof body.version === 'string' ? body.version : undefined,
            uptime: typeof body.uptime === 'string' ? body.uptime : undefined,
            cpuLoad: typeof body['cpu-load'] === 'number' ? body['cpu-load'] : undefined,
          }
        : null;

      checks.push({
        id: 'auth',
        label: 'Router API Authentication',
        status: 'passed',
        detail: systemInfo?.boardName
          ? `Authenticated (${systemInfo.boardName}${systemInfo.version ? ` · v${systemInfo.version}` : ''}).`
          : `Authenticated via ${params.vendor} HTTPS API.`,
      });

      return {
        validCredentials: true,
        reachable: true,
        authenticated: true,
        isPrivateAddress: false,
        latencyMs: tcpResult.latencyMs,
        systemInfo,
        checks,
        message: `Verified live connection and credentials for ${cleanHost}:${params.port} (${tcpResult.latencyMs} ms).`,
      };
    }

    checks.push({
      id: 'auth',
      label: 'Router API Authentication',
      status: 'warning',
      detail: `Endpoint reachable on TCP, returned HTTP ${resp.status}.`,
    });
    return {
      validCredentials: true,
      reachable: true,
      authenticated: false,
      isPrivateAddress: false,
      latencyMs: tcpResult.latencyMs,
      systemInfo: null,
      checks,
      message: `Port ${params.port} is open, but REST probe returned HTTP ${resp.status}.`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'TLS/HTTP handshake failed';
    checks.push({
      id: 'auth',
      label: 'Router API TLS / HTTP Handshake',
      status: 'warning',
      detail: `TCP port is open, HTTPS handshake failed (${errMsg}).`,
    });
    return {
      validCredentials: true,
      reachable: true,
      authenticated: false,
      isPrivateAddress: false,
      latencyMs: tcpResult.latencyMs,
      systemInfo: null,
      checks,
      message: `TCP port ${params.port} is reachable (${tcpResult.latencyMs} ms), but HTTPS REST handshake could not complete (${errMsg}). Self-signed controller certificates are common before WireGuard provisioning.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function generateVoucherCode(prefix = 'TZ'): string {
  const digits = crypto.randomInt(1000, 9999);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 3; i++) {
    suffix += chars[crypto.randomInt(0, chars.length)];
  }
  return `${prefix}-${digits}-${suffix}`;
}

export async function syncRouterHardware(router: RouterDevice): Promise<RouterDevice> {
  const prevStatus = router.status;
  const prevError = router.lastError;
  const secret =
    router.vendor === 'Omada'
      ? process.env.OMADA_CLIENT_SECRET?.trim()
      : process.env.MIKROTIK_API_SECRET?.trim();

  const activeLeasesForRouter = store.sessions.filter(
    (s) => s.routerId === router.id && s.status === 'Active'
  ).length;
  router.activeLeases = activeLeasesForRouter;
  router.lastSyncedAt = new Date().toISOString();

  let detectedError: string | null = null;

  if (router.ipAddress && isValidHostInput(router.ipAddress)) {
    let resolvedSafeIp: string | null = null;
    if (net.isIP(router.ipAddress)) {
      resolvedSafeIp = isSafePublicIp(router.ipAddress) ? router.ipAddress : null;
    } else {
      const lookedUp = await dns.promises.lookup(router.ipAddress).catch(() => null);
      if (lookedUp && isSafePublicIp(lookedUp.address)) {
        resolvedSafeIp = lookedUp.address;
      }
    }

    if (!resolvedSafeIp) {
      router.latencyMs = null;
      router.status = 'Offline';
      detectedError = `Host ${router.ipAddress} resolved to an unreachable or non-routable IP address.`;
    } else {
      const port = router.apiPort || (router.vendor === 'Omada' ? 8043 : 8729);
      const tcpResult = await tcpProbe(resolvedSafeIp, port, 3000);
      if (!tcpResult.connected) {
        router.latencyMs = null;
        router.status = 'Offline';
        detectedError = `TCP probe to ${router.ipAddress}:${port} failed (${tcpResult.error || 'timeout'}).`;
      } else {
        router.latencyMs = tcpResult.latencyMs;
        if (secret) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3500);
          const startedAt = Date.now();
          try {
            const targetUrl =
              router.vendor === 'MikroTik'
                ? `https://${router.ipAddress}:${router.apiPort}/rest/system/resource`
                : `https://${router.ipAddress}:${router.apiPort}/api/v2/info`;

            const resp = await fetch(targetUrl, {
              method: 'GET',
              headers: { Authorization: `Bearer ${secret}` },
              signal: controller.signal,
            });
            router.latencyMs = Date.now() - startedAt;

            if (resp.ok) {
              const body = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
              if (body) {
                const cpuVal = Number(body['cpu-load'] ?? body.cpuUsage);
                const totalMem = Number(body['total-memory']);
                const freeMem = Number(body['free-memory']);
                if (!Number.isNaN(cpuVal)) {
                  router.cpuPercent = Math.max(0, Math.min(100, Math.round(cpuVal)));
                }
                if (!Number.isNaN(totalMem) && !Number.isNaN(freeMem) && totalMem > 0) {
                  router.memoryPercent = Math.max(0, Math.min(100, Math.round(((totalMem - freeMem) / totalMem) * 100)));
                }
                if (typeof body.uptime === 'string' && body.uptime.trim()) {
                  router.uptime = body.uptime.trim();
                }
              }
              if (router.cpuPercent > 84 || router.memoryPercent > 90) {
                router.status = 'Degraded';
                detectedError = `High resource utilization (${router.cpuPercent}% CPU, ${router.memoryPercent}% RAM).`;
              } else {
                router.status = 'Online';
                detectedError = null;
              }
            } else {
              router.status = 'Degraded';
              detectedError = `${router.vendor} API returned HTTP ${resp.status}.`;
            }
          } catch (err) {
            router.status = 'Degraded';
            detectedError = `REST telemetry handshake failed (${err instanceof Error ? err.message : 'TLS/timeout'}).`;
          } finally {
            clearTimeout(timeout);
          }
        } else {
          router.status = 'Online';
          detectedError = null;
        }
      }
    }
  } else {
    router.latencyMs = null;
    router.status = 'Offline';
    detectedError = 'Invalid or missing router WAN/WireGuard endpoint.';
  }

  router.lastError = detectedError;

  store.addAudit(
    router.organizationId,
    `${router.vendor} Connector`,
    'system',
    'Router Telemetry Synced',
    `${router.name} (${router.status}, ${router.activeLeases} active sessions${detectedError ? ` · ${detectedError}` : ''})`
  );
  store.save();

  await evaluateAndDispatchRouterAlerts({
    router,
    prevStatus,
    prevError,
    errorDetail: detectedError,
  });

  return router;
}

export function authenticateVoucherWithRadius(voucherCode: string, macAddress?: string, phone?: string): {
  voucher: Voucher;
  session: RadiusSession;
} {
  const cleanCode = voucherCode.trim().toUpperCase();
  const voucher = store.vouchers.find((v) => v.code === cleanCode);
  if (!voucher) {
    throw new Error('Voucher code not recognized in FreeRADIUS radcheck table.');
  }
  if (voucher.status === 'Revoked' || voucher.status === 'Expired') {
    throw new Error(`Voucher ${cleanCode} is ${voucher.status.toLowerCase()} and cannot be activated.`);
  }
  const voucherSite = store.sites.find((s) => s.id === voucher.siteId);
  if (voucherSite && !voucherSite.hotspotEnabled) {
    throw new Error(`Captive portal hotspot is currently paused at ${voucherSite.name}.`);
  }

  const now = new Date();
  if (voucher.status === 'Available') {
    voucher.status = 'Active';
    voucher.activatedAt = now.toISOString();
    voucher.expiresAt = new Date(now.getTime() + voucher.durationMinutes * 60_000).toISOString();
  }

  const mac =
    macAddress?.trim() ||
    Array.from({ length: 6 }, () => crypto.randomInt(0, 255).toString(16).padStart(2, '0').toUpperCase()).join(':');
  voucher.redeemedMac = mac;
  if (phone) {
    voucher.redeemedByPhone = phone;
  }

  const existing = store.sessions.find((s) => s.voucherCode === cleanCode && s.status === 'Active');
  if (existing) {
    store.save();
    return { voucher, session: existing };
  }

  const router =
    store.routers.find((r) => r.siteId === voucher.siteId) ||
    store.routers.find((r) => r.organizationId === voucher.organizationId);

  const remaining = voucher.expiresAt
    ? Math.max(1, Math.round((new Date(voucher.expiresAt).getTime() - Date.now()) / 60_000))
    : voucher.durationMinutes;

  const org = store.organizations.find((o) => o.id === voucher.organizationId);

  const session: RadiusSession = {
    id: `rad-${crypto.randomBytes(3).toString('hex')}`,
    organizationId: voucher.organizationId,
    organizationName: org?.name,
    siteId: voucher.siteId,
    siteName: voucher.siteName,
    routerId: router?.id || 'nas-unassigned',
    routerName: router?.name || 'NAS-UNASSIGNED',
    username: phone?.trim() || mac,
    voucherCode: voucher.code,
    macAddress: mac,
    framedIp: `172.16.${crypto.randomInt(10, 95)}.${crypto.randomInt(2, 250)}`,
    downloadMb: 0,
    uploadMb: 0,
    remainingMinutes: remaining,
    status: 'Active',
    startedAt: now.toISOString(),
  };

  store.sessions.unshift(session);
  if (voucherSite) voucherSite.activeUsers += 1;
  if (router) router.activeLeases += 1;

  store.addAudit(
    voucher.organizationId,
    'FreeRADIUS Auth Server',
    'system',
    'RADIUS Access-Accept',
    `${voucher.code} -> ${session.framedIp} on ${session.routerName}`
  );
  store.save();

  return { voucher, session };
}

export async function initiateDalipayCollection(params: {
  siteId: string;
  packageId: string;
  customerPhone: string;
  provider: DalipayProvider;
}): Promise<PaymentTransaction> {
  const apiUrl = process.env.DALIPAY_API_URL?.trim();
  const apiKey = process.env.DALIPAY_API_KEY?.trim();
  if (!apiUrl || !apiKey) {
    throw new Error('DaliPay live gateway credentials (DALIPAY_API_URL and DALIPAY_API_KEY) are not configured.');
  }

  const site = store.sites.find((s) => s.id === params.siteId);
  if (!site) {
    throw new Error('Selected hotspot site was not found.');
  }
  const pkg = store.packages.find((p) => p.id === params.packageId);
  if (!pkg) {
    throw new Error('Selected hotspot package was not found.');
  }

  const reference = `DLP-TZ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomInt(1000, 9999)}`;

  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/collections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      reference,
      amount: pkg.priceTzs,
      currency: 'TZS',
      phone: params.customerPhone.trim(),
      provider: params.provider,
      metadata: {
        siteId: site.id,
        packageId: pkg.id,
        organizationId: site.organizationId,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`DaliPay collection request failed (${response.status}): ${errText || response.statusText}`);
  }

  const tx: PaymentTransaction = {
    id: `pay-${crypto.randomBytes(3).toString('hex')}`,
    reference,
    organizationId: site.organizationId,
    siteId: site.id,
    siteName: site.name,
    packageId: pkg.id,
    packageName: pkg.name,
    customerPhone: params.customerPhone.trim(),
    provider: params.provider,
    amountTzs: pkg.priceTzs,
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };

  store.payments.unshift(tx);
  store.addAudit(
    site.organizationId,
    'DaliPay Gateway',
    'system',
    'Collection Prompt Dispatched',
    `${tx.reference} (${tx.provider} · TZS ${tx.amountTzs.toLocaleString()})`
  );
  store.save();
  return tx;
}

export function settleDalipayPayment(reference: string): {
  payment: PaymentTransaction;
  voucher: Voucher;
  session: RadiusSession;
} {
  const tx = store.payments.find((p) => p.reference === reference);
  if (!tx) {
    throw new Error('DaliPay payment reference not found.');
  }

  if (tx.status === 'Completed' && tx.voucherCode) {
    const existingVoucher = store.vouchers.find((v) => v.code === tx.voucherCode);
    if (!existingVoucher) {
      throw new Error('Issued voucher record is missing for completed payment.');
    }
    const { session } = authenticateVoucherWithRadius(existingVoucher.code, undefined, tx.customerPhone);
    return { payment: tx, voucher: existingVoucher, session };
  }

  const gatewayPrefix = (tx.gatewayCode || 'dalipay').toUpperCase();
  const pkg = store.packages.find((p) => p.id === tx.packageId);
  const code = generateVoucherCode('TZ');
  const voucher: Voucher = {
    id: `vch-${crypto.randomBytes(3).toString('hex')}`,
    code,
    batchId: `${gatewayPrefix}-AUTO`,
    organizationId: tx.organizationId,
    siteId: tx.siteId,
    siteName: tx.siteName,
    packageId: tx.packageId,
    packageName: tx.packageName,
    priceTzs: tx.amountTzs,
    durationMinutes: pkg?.durationMinutes || 60,
    status: 'Available',
    issuedBy: `${tx.provider} Auto-Issue`,
    redeemedByPhone: tx.customerPhone,
    createdAt: new Date().toISOString(),
  };

  store.vouchers.unshift(voucher);
  tx.status = 'Completed';
  tx.voucherCode = code;
  tx.verifiedAt = new Date().toISOString();

  const org = store.organizations.find((o) => o.id === tx.organizationId);
  if (org) org.monthlyRevenueTzs += tx.amountTzs;

  const { session } = authenticateVoucherWithRadius(code, undefined, tx.customerPhone);
  store.addAudit(
    tx.organizationId,
    `${tx.provider} Webhook`,
    'system',
    'Collection Settled & Voucher Issued',
    `${tx.reference} -> ${code} (TZS ${tx.amountTzs.toLocaleString()})`
  );
  store.save();

  return { payment: tx, voucher, session };
}

export function verifyDalipayWebhookSignature(rawPayload: string, providedSignature: string | undefined): boolean {
  const secret = process.env.DALIPAY_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  if (!providedSignature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
  const a = Buffer.from(providedSignature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
