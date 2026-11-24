import crypto from 'crypto';
import express, { Router } from 'express';
import type { DalipayProvider, PublicUser, UserRole } from '../../packages/shared/types.ts';
import { generateRouterAutoScript } from '../../packages/shared/routerScripts.ts';
import {
  claimSuperAdmin,
  getAdminBootstrapStatus,
  getOrgName,
  issueToken,
  requireAuth,
  requireRole,
  verifySuperAdminLogin,
  type AuthenticatedRequest,
} from '../auth/auth.service.ts';
import { hashPassword, store, verifyPassword } from '../db/store.ts';
import {
  dispatchGatewayCollection,
  getOrganizationGateways,
  isValidGatewayCode,
  upsertOrganizationGateway,
  verifyGatewayWebhookSignature,
} from '../integrations/gateways.ts';
import {
  dispatchRouterAlertEmail,
  getDefaultAdminRecipients,
  getEmailTransportStatus,
  getRouterAlertSetting,
  isValidEmail,
  upsertRouterAlertSetting,
} from '../integrations/alerts.ts';
import {
  authenticateVoucherWithRadius,
  extractSafePublicIpFromCandidate,
  generateVoucherCode,
  inspectPublicWanIp,
  settleDalipayPayment,
  syncRouterHardware,
  testRouterConnection,
} from '../integrations/services.ts';
import { runRouterHealthSweep, runWorkerCycle } from '../worker/jobs.ts';

export const apiRouter = Router();

apiRouter.use(express.json({ limit: '1mb' }));

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'xcloud-tz-api', timestamp: new Date().toISOString() });
});

/* ============================================================================
 * PUBLIC CATALOG, CAPTIVE PORTAL & LEAD CAPTURE
 * ============================================================================ */

apiRouter.get('/public/catalog', (_req, res) => {
  const activeSites = store.sites.filter((s) => s.status === 'Active' && s.hotspotEnabled);
  const activeOrgIds = Array.from(new Set(activeSites.map((s) => s.organizationId)));
  const enabledGateways = activeOrgIds.flatMap((orgId) =>
    getOrganizationGateways(orgId)
      .filter((g) => g.enabled)
      .map((g) => ({
        organizationId: g.organizationId,
        code: g.code,
        name: g.name,
        providerLabel: g.providerLabel,
        channels: g.channels,
        credentialsConfigured: g.credentialsConfigured,
      }))
  );

  res.json({
    sites: activeSites,
    packages: store.packages.filter((p) => p.active),
    enabledGateways,
    metrics: {
      activeHotspots: activeSites.length,
      onlineRouters: store.routers.filter((r) => r.status === 'Online').length,
      activeSessions: store.sessions.filter((s) => s.status === 'Active').length,
      totalVouchersIssued: store.vouchers.length,
    },
  });
});

apiRouter.post('/public/leads', (req, res) => {
  const { name, email, company, sitesCount, message } = req.body ?? {};
  if (!name || !email || typeof name !== 'string' || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Valid contact name and email address are required.' });
    return;
  }
  const lead = {
    id: `lead-${crypto.randomBytes(3).toString('hex')}`,
    name: name.trim().slice(0, 120),
    email: email.trim().toLowerCase().slice(0, 160),
    company: typeof company === 'string' && company.trim() ? company.trim().slice(0, 120) : 'Independent Operator',
    sitesCount: typeof sitesCount === 'string' ? sitesCount.slice(0, 40) : '1-5 sites',
    message: typeof message === 'string' ? message.trim().slice(0, 1000) : '',
    createdAt: new Date().toISOString(),
  };
  store.leads.unshift(lead);
  store.save();
  res.status(201).json({ ok: true, leadId: lead.id });
});

apiRouter.post('/captive/authenticate', (req, res) => {
  const { voucherCode, macAddress, phone } = req.body ?? {};
  if (!voucherCode || typeof voucherCode !== 'string') {
    res.status(400).json({ error: 'Please enter a valid WiFi voucher code.' });
    return;
  }
  try {
    const result = authenticateVoucherWithRadius(voucherCode, macAddress, phone);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Voucher authentication failed.' });
  }
});

const ALLOWED_GATEWAY_PROVIDERS: DalipayProvider[] = [
  'DaliPay M-Pesa',
  'DaliPay Tigo Pesa',
  'DaliPay Airtel Money',
  'DaliPay Halopesa',
  'Vodacom M-Pesa',
  'Tigo Pesa',
  'Airtel Money',
  'Selcom Pay',
  'AzamPay',
];

apiRouter.post('/captive/purchase', async (req, res) => {
  const { siteId, packageId, customerPhone, gatewayCode, provider } = req.body ?? {};
  if (!customerPhone || typeof customerPhone !== 'string' || customerPhone.trim().length < 9) {
    res.status(400).json({ error: 'Valid Tanzanian mobile money number is required (e.g. +255754...).' });
    return;
  }
  if (!siteId || typeof siteId !== 'string') {
    res.status(400).json({ error: 'Please select an active hotspot site.' });
    return;
  }
  if (!packageId || typeof packageId !== 'string') {
    res.status(400).json({ error: 'Please select an internet package.' });
    return;
  }

  const targetSite = store.sites.find((s) => s.id === siteId);
  if (!targetSite) {
    res.status(404).json({ error: 'Selected hotspot site was not found.' });
    return;
  }
  if (!targetSite.hotspotEnabled) {
    res.status(403).json({ error: `Captive portal hotspot is currently paused at ${targetSite.name}.` });
    return;
  }

  const pkg = store.packages.find((p) => p.id === packageId && p.active);
  if (!pkg) {
    res.status(404).json({ error: 'Selected internet package was not found or is inactive.' });
    return;
  }
  if (pkg.organizationId !== targetSite.organizationId) {
    res.status(400).json({ error: 'Selected internet package does not belong to this hotspot site organization.' });
    return;
  }

  const chosenGatewayCode =
    typeof gatewayCode === 'string' && isValidGatewayCode(gatewayCode) ? gatewayCode : 'dalipay';
  const chosenProvider =
    typeof provider === 'string' && ALLOWED_GATEWAY_PROVIDERS.includes(provider as DalipayProvider)
      ? (provider as DalipayProvider)
      : undefined;

  try {
    const tx = await dispatchGatewayCollection({
      gatewayCode: chosenGatewayCode,
      site: targetSite,
      pkg,
      customerPhone,
      providerLabel: chosenProvider,
    });
    res.status(201).json({ payment: tx });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to initiate mobile money collection.';
    const status = msg.includes('not configured') ? 503 : msg.includes('not enabled') ? 403 : 400;
    res.status(status).json({ error: msg });
  }
});

apiRouter.get('/captive/payment-status/:reference', (req, res) => {
  const tx = store.payments.find((p) => p.reference === req.params.reference);
  if (!tx) {
    res.status(404).json({ error: 'Payment reference not found.' });
    return;
  }
  if (tx.status === 'Completed' && tx.voucherCode) {
    const voucher = store.vouchers.find((v) => v.code === tx.voucherCode);
    const session = store.sessions.find((s) => s.voucherCode === tx.voucherCode && s.status === 'Active');
    res.json({ payment: tx, voucher, session });
    return;
  }
  res.json({ payment: tx });
});

function handleGatewayWebhook(gatewayCodeParam: string, req: express.Request, res: express.Response) {
  if (!isValidGatewayCode(gatewayCodeParam)) {
    res.status(404).json({ error: 'Unsupported payment gateway webhook endpoint.' });
    return;
  }
  const sig =
    req.header('x-webhook-signature') ||
    req.header('x-dalipay-signature') ||
    req.header('x-selcom-signature') ||
    req.header('x-azampay-signature');
  const rawBody = JSON.stringify(req.body ?? {});
  if (!verifyGatewayWebhookSignature(gatewayCodeParam, rawBody, sig)) {
    res.status(401).json({ error: `Invalid or unconfigured ${gatewayCodeParam} webhook signature.` });
    return;
  }

  const { reference } = req.body ?? {};
  if (!reference || typeof reference !== 'string') {
    res.status(400).json({ error: 'Missing payment reference in webhook payload.' });
    return;
  }
  const tx = store.payments.find((p) => p.reference === reference);
  if (!tx) {
    res.status(404).json({ error: 'Payment reference not found.' });
    return;
  }
  if (tx.gatewayCode && tx.gatewayCode !== gatewayCodeParam) {
    res.status(403).json({ error: 'Webhook gateway mismatch for payment reference.' });
    return;
  }

  try {
    const result = settleDalipayPayment(reference);
    res.json({ received: true, gatewayCode: gatewayCodeParam, voucherCode: result.voucher.code });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Reference not found.' });
  }
}

apiRouter.post('/payments/webhooks/:gatewayCode', (req, res) => {
  handleGatewayWebhook(req.params.gatewayCode, req, res);
});

apiRouter.post('/payments/dalipay/webhook', (req, res) => {
  handleGatewayWebhook('dalipay', req, res);
});

/* ============================================================================
 * AUTHENTICATION & FIRST-RUN ADMIN CLAIM
 * ============================================================================ */

apiRouter.get('/auth/bootstrap-status', (_req, res) => {
  res.json(getAdminBootstrapStatus());
});

apiRouter.post('/auth/claim-admin', (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name || !email || !password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' });
    return;
  }
  try {
    const result = claimSuperAdmin(String(name), String(email), password);
    res.status(201).json(result);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : 'Admin already claimed.' });
  }
});

apiRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const superAdmin = verifySuperAdminLogin(email, password);
  if (superAdmin) {
    store.addAudit(superAdmin.organizationId, superAdmin.name, 'super-admin', 'Signed In', superAdmin.email);
    res.json({ user: superAdmin, token: issueToken(superAdmin) });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const account = store.users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (!account || !verifyPassword(password, account.passwordSalt, account.passwordHash)) {
    res.status(401).json({ error: 'Invalid email address or password.' });
    return;
  }

  const user: PublicUser = {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    organizationId: account.organizationId,
    organizationName: getOrgName(account.organizationId),
    phone: account.phone,
  };
  store.addAudit(user.organizationId, user.name, user.role, 'Signed In', user.email);
  res.json({ user, token: issueToken(user) });
});

apiRouter.post('/auth/register', (req, res) => {
  const { name, email, password, role, organizationName, phone } = req.body ?? {};
  if (!name || !email || !password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Full name, email, and password (8+ chars) are required.' });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (store.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const allowedSignupRoles: UserRole[] = ['customer', 'agent', 'admin'];
  const assignedRole: UserRole = allowedSignupRoles.includes(role) ? role : 'customer';

  let orgId = store.organizations[0]?.id || '';
  if (assignedRole === 'admin') {
    if (typeof organizationName !== 'string' || organizationName.trim().length < 2) {
      res.status(400).json({ error: 'Organization / ISP name is required for ISP Admin accounts.' });
      return;
    }
    const newOrgId = `org-${crypto.randomBytes(3).toString('hex')}`;
    store.organizations.push({
      id: newOrgId,
      name: organizationName.trim().slice(0, 80),
      slug: organizationName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      plan: 'Starter',
      status: 'Active',
      country: 'Tanzania',
      currency: 'TZS',
      siteLimit: 5,
      routerLimit: 10,
      monthlyRevenueTzs: 0,
      createdAt: new Date().toISOString(),
    });
    orgId = newOrgId;
  } else if (!orgId) {
    const defaultOrgId = `org-${crypto.randomBytes(3).toString('hex')}`;
    store.organizations.push({
      id: defaultOrgId,
      name: 'XCLOUD.NET Primary Network',
      slug: 'xcloud-primary',
      plan: 'Starter',
      status: 'Active',
      country: 'Tanzania',
      currency: 'TZS',
      siteLimit: 5,
      routerLimit: 10,
      monthlyRevenueTzs: 0,
      createdAt: new Date().toISOString(),
    });
    orgId = defaultOrgId;
  }

  const { salt, hash } = hashPassword(password);
  const newUserId = `usr-${crypto.randomBytes(4).toString('hex')}`;
  store.users.push({
    id: newUserId,
    email: normalizedEmail,
    name: String(name).trim().slice(0, 80),
    role: assignedRole,
    organizationId: orgId,
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : undefined,
    passwordSalt: salt,
    passwordHash: hash,
  });

  if (assignedRole === 'agent') {
    const orgSite = store.sites.find((s) => s.organizationId === orgId);
    store.agents.push({
      id: `agt-${crypto.randomBytes(3).toString('hex')}`,
      organizationId: orgId,
      name: String(name).trim(),
      phone: typeof phone === 'string' && phone.trim() ? phone.trim() : '',
      email: normalizedEmail,
      siteName: orgSite?.name || 'Unassigned Site',
      commissionRatePercent: 10,
      vouchersSold: 0,
      totalSalesTzs: 0,
      pendingPayoutTzs: 0,
      paidOutTzs: 0,
      status: 'Active',
    });
  }

  const publicUser: PublicUser = {
    id: newUserId,
    email: normalizedEmail,
    name: String(name).trim(),
    role: assignedRole,
    organizationId: orgId,
    organizationName: getOrgName(orgId),
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : undefined,
  };
  store.addAudit(orgId, publicUser.name, assignedRole, 'Account Registered', normalizedEmail);
  store.save();
  res.status(201).json({ user: publicUser, token: issueToken(publicUser) });
});

apiRouter.post('/auth/forgot-password', (req, res) => {
  const { email } = req.body ?? {};
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email address is required.' });
    return;
  }
  const normalized = email.trim().toLowerCase();
  const account = store.users.find((u) => u.email.toLowerCase() === normalized);
  if (account) {
    const code = crypto.randomInt(100000, 999999).toString();
    store.resetTokens.set(code, { email: normalized, expiresAt: Date.now() + 15 * 60_000 });
  }
  res.json({ ok: true, message: 'If that account exists, password reset instructions have been queued.' });
});

apiRouter.post('/auth/reset-password', (req, res) => {
  const { code, newPassword } = req.body ?? {};
  if (!code || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Reset code and new password (8+ characters) are required.' });
    return;
  }
  const entry = store.resetTokens.get(String(code).trim());
  if (!entry || Date.now() > entry.expiresAt) {
    res.status(400).json({ error: 'Reset code is invalid or expired.' });
    return;
  }
  const account = store.users.find((u) => u.email.toLowerCase() === entry.email);
  if (!account) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  const { salt, hash } = hashPassword(newPassword);
  account.passwordSalt = salt;
  account.passwordHash = hash;
  store.resetTokens.delete(String(code).trim());
  store.save();
  res.json({ ok: true, message: 'Password updated. You may now sign in.' });
});

apiRouter.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

/* ============================================================================
 * PROTECTED MANAGEMENT PORTAL ROUTES
 * ============================================================================ */

function scopeByOrg<T extends { organizationId: string }>(items: T[], user: PublicUser): T[] {
  if (user.role === 'super-admin' || user.role === 'support') return items;
  return items.filter((item) => item.organizationId === user.organizationId);
}

apiRouter.get('/overview', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const sites = scopeByOrg(store.sites, user);
  const routers = scopeByOrg(store.routers, user);
  const vouchers = scopeByOrg(store.vouchers, user);
  const payments = scopeByOrg(store.payments, user);
  const sessions = scopeByOrg(store.sessions, user);
  const tickets = scopeByOrg(store.tickets, user);
  const agents = scopeByOrg(store.agents, user);

  const completedPayments = payments.filter((p) => p.status === 'Completed');
  const completedRevenue = completedPayments.reduce((sum, p) => sum + p.amountTzs, 0);

  // Aggregate real hourly traffic & sales across 6 3-hour buckets for the current day
  const hourBuckets = [
    { hour: '06:00', startHour: 6, endHour: 9 },
    { hour: '09:00', startHour: 9, endHour: 12 },
    { hour: '12:00', startHour: 12, endHour: 15 },
    { hour: '15:00', startHour: 15, endHour: 18 },
    { hour: '18:00', startHour: 18, endHour: 21 },
    { hour: '21:00', startHour: 21, endHour: 24 },
  ];

  const hourlyTraffic = hourBuckets.map((bucket) => {
    const bucketSessions = sessions.filter((s) => {
      const h = new Date(s.startedAt).getHours();
      return h >= bucket.startHour && h < bucket.endHour;
    });
    const bucketSales = completedPayments.filter((p) => {
      const h = new Date(p.verifiedAt || p.createdAt).getHours();
      return h >= bucket.startHour && h < bucket.endHour;
    });
    const totalMb = bucketSessions.reduce((acc, s) => acc + s.downloadMb + s.uploadMb, 0);
    return {
      hour: bucket.hour,
      mbps: Math.round(totalMb),
      sales: bucketSales.length,
    };
  });

  // Compute genuine 14-day daily revenue and session metrics from persisted records
  const dailyMetrics = Array.from({ length: 14 }, (_, idx) => {
    const offset = 13 - idx;
    const dayDate = new Date(Date.now() - offset * 86_400_000);
    const dayKey = dayDate.toISOString().slice(0, 10);
    const label = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const dayRevenue = completedPayments
      .filter((p) => (p.verifiedAt || p.createdAt).slice(0, 10) === dayKey)
      .reduce((sum, p) => sum + p.amountTzs, 0);

    const daySessions = sessions.filter((s) => {
      const startedDay = s.startedAt.slice(0, 10);
      return startedDay === dayKey || (offset === 0 && s.status === 'Active');
    }).length;

    return {
      date: label,
      revenueTzs: dayRevenue,
      activeSessions: daySessions,
    };
  });

  res.json({
    kpis: {
      totalRevenueTzs: completedRevenue,
      activeSessions: sessions.filter((s) => s.status === 'Active').length,
      onlineRouters: routers.filter((r) => r.status === 'Online').length,
      totalRouters: routers.length,
      availableVouchers: vouchers.filter((v) => v.status === 'Available').length,
      openTickets: tickets.filter((t) => t.status !== 'Resolved').length,
      activeAgents: agents.filter((a) => a.status === 'Active').length,
      totalSites: sites.length,
    },
    hourlyTraffic,
    dailyMetrics,
  });
});

// Organizations (Super Admin)
apiRouter.get('/organizations', requireAuth, requireRole('super-admin'), (_req, res) => {
  res.json({ organizations: store.organizations });
});

apiRouter.post('/organizations', requireAuth, requireRole('super-admin'), (req: AuthenticatedRequest, res) => {
  const { name, plan, country, siteLimit, routerLimit } = req.body ?? {};
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Organization name is required.' });
    return;
  }
  const org = {
    id: `org-${crypto.randomBytes(3).toString('hex')}`,
    name: name.trim().slice(0, 80),
    slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    plan: (['Starter', 'Regional ISP', 'Carrier Multi-Tenant'].includes(plan) ? plan : 'Regional ISP') as
      | 'Starter'
      | 'Regional ISP'
      | 'Carrier Multi-Tenant',
    status: 'Active' as const,
    country: typeof country === 'string' && country.trim() ? country.trim() : 'Tanzania',
    currency: 'TZS',
    siteLimit: Number(siteLimit) || 20,
    routerLimit: Number(routerLimit) || 40,
    monthlyRevenueTzs: 0,
    createdAt: new Date().toISOString(),
  };
  store.organizations.unshift(org);
  store.addAudit(org.id, req.user!.name, req.user!.role, 'Tenant Created', org.name);
  store.save();
  res.status(201).json({ organization: org });
});

apiRouter.patch('/organizations/:id/toggle', requireAuth, requireRole('super-admin'), (req: AuthenticatedRequest, res) => {
  const org = store.organizations.find((o) => o.id === req.params.id);
  if (!org) {
    res.status(404).json({ error: 'Organization not found.' });
    return;
  }
  org.status = org.status === 'Active' ? 'Suspended' : 'Active';
  store.addAudit(org.id, req.user!.name, req.user!.role, 'Tenant Status Changed', `${org.name} -> ${org.status}`);
  store.save();
  res.json({ organization: org });
});

// Sites
apiRouter.get('/sites', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ sites: scopeByOrg(store.sites, req.user!) });
});

apiRouter.post('/sites', requireAuth, requireRole('super-admin', 'admin'), (req: AuthenticatedRequest, res) => {
  const { name, location, ssid, captivePortalTitle } = req.body ?? {};
  if (!name || !location || !ssid) {
    res.status(400).json({ error: 'Site name, location, and WiFi SSID are required.' });
    return;
  }
  const site = {
    id: `site-${crypto.randomBytes(3).toString('hex')}`,
    organizationId: req.user!.organizationId,
    name: String(name).trim().slice(0, 80),
    location: String(location).trim().slice(0, 80),
    ssid: String(ssid).trim().slice(0, 32),
    captivePortalTitle: String(captivePortalTitle || `${name} WiFi`).trim().slice(0, 80),
    activeUsers: 0,
    status: 'Active' as const,
    hotspotEnabled: true,
    voucherPdfEnabled: true,
    walledGardenHosts: ['portal.xcloud.co.tz', 'api.dalipay.co.tz'],
  };
  store.sites.unshift(site);
  store.addAudit(req.user!.organizationId, req.user!.name, req.user!.role, 'Hotspot Site Added', site.name);
  store.save();
  res.status(201).json({ site });
});

apiRouter.patch('/sites/:id/hotspot-setup', requireAuth, requireRole('super-admin', 'admin', 'support'), (req: AuthenticatedRequest, res) => {
  const site = store.sites.find((s) => s.id === req.params.id);
  if (!site) {
    res.status(404).json({ error: 'Hotspot site not found.' });
    return;
  }
  if (req.user!.role !== 'super-admin' && req.user!.role !== 'support' && site.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: 'Cross-organization site access denied.' });
    return;
  }
  const { ssid, captivePortalTitle, hotspotEnabled, voucherPdfEnabled, walledGardenHosts } = req.body ?? {};
  if (typeof ssid === 'string' && ssid.trim()) {
    site.ssid = ssid.trim().slice(0, 32);
  }
  if (typeof captivePortalTitle === 'string' && captivePortalTitle.trim()) {
    site.captivePortalTitle = captivePortalTitle.trim().slice(0, 80);
  }
  if (typeof hotspotEnabled === 'boolean') {
    site.hotspotEnabled = hotspotEnabled;
  }
  if (typeof voucherPdfEnabled === 'boolean') {
    site.voucherPdfEnabled = voucherPdfEnabled;
  }
  if (Array.isArray(walledGardenHosts)) {
    site.walledGardenHosts = walledGardenHosts
      .map((h) => String(h).trim())
      .filter((h) => h.length > 0)
      .slice(0, 15);
  }
  store.addAudit(
    site.organizationId,
    req.user!.name,
    req.user!.role,
    'Hotspot Setup Updated',
    `${site.name} (Hotspot: ${site.hotspotEnabled ? 'Enabled' : 'Paused'}, Voucher PDF: ${site.voucherPdfEnabled ? 'Enabled' : 'Disabled'})`
  );
  store.save();
  res.json({ site });
});

// Routers
const verifiedRouterTests = new Map<string, { timestamp: number; latencyMs: number | null }>();

apiRouter.get('/routers', requireAuth, (req: AuthenticatedRequest, res) => {
  const scoped = scopeByOrg(store.routers, req.user!).map((r) => ({
    ...r,
    organizationName: getOrgName(r.organizationId),
  }));
  res.json({ routers: scoped });
});

apiRouter.post('/routers/test-connection', requireAuth, requireRole('super-admin', 'admin', 'support'), async (req: AuthenticatedRequest, res) => {
  const { vendor, ipAddress, apiPort, username, password } = req.body ?? {};
  const normalizedVendor = vendor === 'Omada' ? 'Omada' : 'MikroTik';
  const portNum = Number(apiPort) || (normalizedVendor === 'Omada' ? 8043 : 8729);
  const cleanHost = typeof ipAddress === 'string' ? ipAddress.trim() : '';

  if (!cleanHost) {
    res.status(400).json({ error: 'WAN IP address or controller hostname is required.' });
    return;
  }
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Router API username and password/token are required.' });
    return;
  }

  try {
    const result = await testRouterConnection({
      vendor: normalizedVendor,
      host: cleanHost,
      port: portNum,
      username,
      password,
    });

    if (result.reachable && result.authenticated) {
      verifiedRouterTests.set(`${req.user!.organizationId}:${cleanHost.toLowerCase()}:${portNum}`, {
        timestamp: Date.now(),
        latencyMs: result.latencyMs,
      });
    }

    store.addAudit(
      req.user!.organizationId,
      req.user!.name,
      req.user!.role,
      'Router Connection Test',
      `${normalizedVendor} ${cleanHost}:${portNum} -> ${result.authenticated ? 'Verified' : result.reachable ? 'TCP Reachable' : result.isPrivateAddress ? 'Private IP' : 'Unreachable'}`
    );

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid router connection parameters.' });
  }
});

apiRouter.post('/routers/sync-all', requireAuth, requireRole('super-admin', 'admin', 'support'), async (req: AuthenticatedRequest, res) => {
  const scoped = scopeByOrg(store.routers, req.user!);
  await Promise.all(scoped.map((router) => syncRouterHardware(router)));
  const updated = scopeByOrg(store.routers, req.user!).map((r) => ({
    ...r,
    organizationName: getOrgName(r.organizationId),
  }));
  res.json({ routers: updated });
});

function generateWireGuardKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  return {
    publicKey: pubDer.subarray(pubDer.length - 32).toString('base64'),
    privateKey: privDer.subarray(privDer.length - 32).toString('base64'),
  };
}

function getOrInitWireGuardHub(): { publicKey: string; endpoint: string } {
  const envPub = process.env.WIREGUARD_SERVER_PUBLIC_KEY?.trim();
  const envEndpoint = process.env.WIREGUARD_SERVER_ENDPOINT?.trim() || 'vpn.xcloud.co.tz:51820';
  if (envPub) {
    return { publicKey: envPub, endpoint: envEndpoint };
  }
  if (!store.wireguardHub?.publicKey) {
    const generated = generateWireGuardKeypair();
    store.wireguardHub = {
      publicKey: generated.publicKey,
      endpoint: envEndpoint,
    };
    store.save();
  }
  return {
    publicKey: store.wireguardHub.publicKey,
    endpoint: envEndpoint,
  };
}

function nextAvailableTunnelIp(): string {
  const used = new Set(store.routers.map((r) => r.wireguardTunnelIp.trim()));
  for (let host = 10; host <= 250; host++) {
    const candidate = `10.66.0.${host}`;
    if (!used.has(candidate)) return candidate;
  }
  return `10.66.${crypto.randomInt(1, 250)}.${crypto.randomInt(10, 250)}`;
}

apiRouter.post('/routers/detect-wan', requireAuth, requireRole('super-admin', 'admin', 'support'), async (req: AuthenticatedRequest, res) => {
  const { vendor, candidateIp, probePorts } = req.body ?? {};
  const normalizedVendor = vendor === 'Omada' ? 'Omada' : 'MikroTik';

  const headerCandidates: string[] = [];
  const xff = req.header('x-forwarded-for');
  if (xff) {
    for (const part of xff.split(',')) {
      headerCandidates.push(part.trim());
    }
  }
  const cfIp = req.header('cf-connecting-ip');
  if (cfIp) headerCandidates.push(cfIp.trim());
  const realIp = req.header('x-real-ip');
  if (realIp) headerCandidates.push(realIp.trim());
  if (req.socket?.remoteAddress) headerCandidates.push(req.socket.remoteAddress);

  let detectedIp: string | null = null;
  let source: 'request-header' | 'client-probe' = 'request-header';

  for (const raw of headerCandidates) {
    const safe = extractSafePublicIpFromCandidate(raw);
    if (safe) {
      detectedIp = safe;
      break;
    }
  }

  if (!detectedIp && candidateIp) {
    const safeClient = extractSafePublicIpFromCandidate(candidateIp);
    if (safeClient) {
      detectedIp = safeClient;
      source = 'client-probe';
    }
  }

  if (!detectedIp) {
    res.json({
      detected: false,
      publicIp: null,
      reverseHost: null,
      source: 'local',
      openPorts: [],
      recommendedPort: normalizedVendor === 'Omada' ? 8043 : 443,
      message: 'No public WAN IP observed on this connection (local/private network). Enter your router WAN IP, MikroTik Cloud DDNS, or click Use WG Tunnel.',
    });
    return;
  }

  const result = await inspectPublicWanIp({
    publicIp: detectedIp,
    vendor: normalizedVendor,
    source,
    probePorts: probePorts !== false,
  });

  res.json(result);
});

apiRouter.post('/routers/wireguard/generate', requireAuth, requireRole('super-admin', 'admin', 'support'), (_req: AuthenticatedRequest, res) => {
  const clientKeys = generateWireGuardKeypair();
  const presharedKey = crypto.randomBytes(32).toString('base64');
  const hub = getOrInitWireGuardHub();
  const tunnelIp = nextAvailableTunnelIp();

  res.json({
    tunnelIp,
    clientPrivateKey: clientKeys.privateKey,
    clientPublicKey: clientKeys.publicKey,
    presharedKey,
    serverPublicKey: hub.publicKey,
    serverEndpoint: hub.endpoint,
  });
});

apiRouter.post('/routers', requireAuth, requireRole('super-admin', 'admin', 'support'), (req: AuthenticatedRequest, res) => {
  const { name, vendor, model, ipAddress, siteId, apiPort, wireguardTunnelIp, wireguardPublicKey, bridgeName, hotspotSubnet } = req.body ?? {};
  if (!name || !ipAddress) {
    res.status(400).json({ error: 'Router name and WAN/WireGuard IP address are required.' });
    return;
  }
  const availableSites = scopeByOrg(store.sites, req.user!);
  const site = availableSites.find((s) => s.id === siteId) || availableSites[0];
  if (!site) {
    res.status(400).json({ error: 'Create a hotspot site first before provisioning a router.' });
    return;
  }

  const normalizedVendor = (vendor === 'Omada' ? 'Omada' : 'MikroTik') as 'MikroTik' | 'Omada';
  const cleanHost = String(ipAddress).trim().slice(0, 120);
  const resolvedPort =
    Number.isInteger(Number(apiPort)) && Number(apiPort) >= 1 && Number(apiPort) <= 65535
      ? Number(apiPort)
      : normalizedVendor === 'Omada'
      ? 8043
      : 8729;

  const wgIp =
    typeof wireguardTunnelIp === 'string' && /^10\.66\.\d{1,3}\.\d{1,3}$/.test(wireguardTunnelIp.trim())
      ? wireguardTunnelIp.trim()
      : nextAvailableTunnelIp();

  const validWgPubKey =
    typeof wireguardPublicKey === 'string' && /^[A-Za-z0-9+/]{42,43}=$/.test(wireguardPublicKey.trim())
      ? wireguardPublicKey.trim()
      : undefined;

  const verifyKey = `${req.user!.organizationId}:${cleanHost.toLowerCase()}:${resolvedPort}`;
  const verifiedEntry = verifiedRouterTests.get(verifyKey);
  const isVerifiedOnline = Boolean(verifiedEntry && Date.now() - verifiedEntry.timestamp < 15 * 60_000);

  const router = {
    id: `rtr-${crypto.randomBytes(3).toString('hex')}`,
    organizationId: site.organizationId,
    organizationName: getOrgName(site.organizationId),
    siteId: site.id,
    siteName: site.name,
    name: String(name).trim().toUpperCase().slice(0, 40),
    vendor: normalizedVendor,
    model: String(model || (normalizedVendor === 'Omada' ? 'Omada OC300' : 'MikroTik RB5009')).trim().slice(0, 60),
    ipAddress: cleanHost,
    wireguardTunnelIp: wgIp,
    wireguardPublicKey: validWgPubKey,
    apiPort: resolvedPort,
    bridgeName: typeof bridgeName === 'string' && bridgeName.trim() ? bridgeName.trim().slice(0, 32) : 'bridge-hotspot',
    hotspotSubnet: typeof hotspotSubnet === 'string' && hotspotSubnet.trim() ? hotspotSubnet.trim().slice(0, 24) : '10.5.50.0/24',
    status: (isVerifiedOnline ? 'Online' : 'Offline') as 'Online' | 'Offline',
    latencyMs: isVerifiedOnline ? verifiedEntry?.latencyMs ?? null : null,
    cpuPercent: 0,
    memoryPercent: 0,
    activeLeases: 0,
    uptime: isVerifiedOnline ? 'Connected' : 'Awaiting WireGuard',
    lastSyncedAt: new Date().toISOString(),
  };
  store.routers.unshift(router);
  store.addAudit(router.organizationId, req.user!.name, req.user!.role, 'Router Provisioned', `${router.name} (${router.vendor} · ${router.status})`);
  store.save();
  res.status(201).json({ router });
});

apiRouter.post('/routers/:id/sync', requireAuth, requireRole('super-admin', 'admin', 'support'), async (req: AuthenticatedRequest, res) => {
  const router = store.routers.find((r) => r.id === req.params.id);
  if (!router) {
    res.status(404).json({ error: 'Router not found.' });
    return;
  }
  if (req.user!.role !== 'super-admin' && req.user!.role !== 'support' && router.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: 'Cross-organization router access denied.' });
    return;
  }
  const updated = await syncRouterHardware(router);
  res.json({ router: { ...updated, organizationName: getOrgName(updated.organizationId) } });
});

interface ProvisionBootstrapEntry {
  routerId: string;
  organizationId: string;
  origin: string;
  wireguardEndpoint?: string;
  serverPublicKey?: string;
  clientPrivateKey?: string;
  clientPublicKey?: string;
  presharedKey?: string;
  bridgePorts?: string;
  expiresAt: number;
}

const provisionTokens = new Map<string, ProvisionBootstrapEntry>();

function resolveSafeOrigin(rawOrigin: unknown, req: express.Request): string {
  if (typeof rawOrigin === 'string' && rawOrigin.trim()) {
    try {
      const parsed = new URL(rawOrigin.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed origin
    }
  }
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // Fallback below
    }
  }
  const proto = req.header('x-forwarded-proto') || req.protocol || 'https';
  const host = req.header('x-forwarded-host') || req.header('host') || 'portal.xcloud.co.tz';
  return `${proto}://${host}`;
}

apiRouter.get('/routers/:id/script', requireAuth, requireRole('super-admin', 'admin', 'support'), (req: AuthenticatedRequest, res) => {
  const router = store.routers.find((r) => r.id === req.params.id);
  if (!router) {
    res.status(404).json({ error: 'Router not found.' });
    return;
  }
  if (req.user!.role !== 'super-admin' && req.user!.role !== 'support' && router.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: 'Cross-organization router access denied.' });
    return;
  }

  const site = store.sites.find((s) => s.id === router.siteId);
  const origin = resolveSafeOrigin(req.query.origin, req);
  const hub = getOrInitWireGuardHub();
  const script = generateRouterAutoScript({
    vendor: router.vendor,
    routerName: router.name,
    model: router.model,
    site,
    wanHost: router.ipAddress,
    apiPort: router.apiPort,
    apiUsername: 'xcloud-api',
    wireguardTunnelIp: router.wireguardTunnelIp,
    wireguardEndpoint: hub.endpoint,
    wireguardPublicKey: hub.publicKey,
    wireguardClientPublicKey: router.wireguardPublicKey,
    radiusSecret: process.env.RADIUS_SECRET?.trim() || undefined,
    bridgeName: router.bridgeName || 'bridge-hotspot',
    bridgePorts: router.vendor === 'MikroTik' ? 'ether2,ether3,ether4,wlan1' : 'LAN1,LAN2,WLAN-Hotspot',
    hotspotSubnet: router.hotspotSubnet || '10.5.50.0/24',
    captivePortalOrigin: origin,
  });

  res.json({ script });
});

apiRouter.post('/routers/:id/provision-token', requireAuth, requireRole('super-admin', 'admin', 'support'), (req: AuthenticatedRequest, res) => {
  const router = store.routers.find((r) => r.id === req.params.id);
  if (!router) {
    res.status(404).json({ error: 'Router not found.' });
    return;
  }
  if (req.user!.role !== 'super-admin' && req.user!.role !== 'support' && router.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: 'Cross-organization router access denied.' });
    return;
  }

  // Prune expired tokens
  const now = Date.now();
  for (const [key, entry] of provisionTokens.entries()) {
    if (entry.expiresAt <= now) provisionTokens.delete(key);
  }

  const {
    origin: rawOrigin,
    wireguardEndpoint,
    serverPublicKey,
    clientPrivateKey,
    clientPublicKey,
    presharedKey,
    bridgePorts,
  } = req.body ?? {};
  const origin = resolveSafeOrigin(rawOrigin, req);
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = now + 30 * 60_000;
  const hub = getOrInitWireGuardHub();

  const isWgKey = (val: unknown): val is string =>
    typeof val === 'string' && /^[A-Za-z0-9+/]{42,43}=$/.test(val.trim());

  provisionTokens.set(token, {
    routerId: router.id,
    organizationId: router.organizationId,
    origin,
    wireguardEndpoint:
      typeof wireguardEndpoint === 'string' && wireguardEndpoint.trim()
        ? wireguardEndpoint.trim().slice(0, 100)
        : hub.endpoint,
    serverPublicKey: isWgKey(serverPublicKey) ? serverPublicKey.trim() : hub.publicKey,
    clientPrivateKey: isWgKey(clientPrivateKey) ? clientPrivateKey.trim() : undefined,
    clientPublicKey: isWgKey(clientPublicKey) ? clientPublicKey.trim() : router.wireguardPublicKey,
    presharedKey: isWgKey(presharedKey) ? presharedKey.trim() : undefined,
    bridgePorts: typeof bridgePorts === 'string' && bridgePorts.trim() ? bridgePorts.trim().slice(0, 120) : undefined,
    expiresAt,
  });

  const fetchUrl = `${origin}/api/routers/bootstrap/${token}`;
  const filename = `${router.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}-xcloud-autoprovision.${router.vendor === 'MikroTik' ? 'rsc' : 'sh'}`;
  const oneLineCommand =
    router.vendor === 'MikroTik'
      ? `/tool fetch url="${fetchUrl}" mode=https dst-path=${filename}; :delay 1s; /import file-name=${filename}`
      : `curl -fsSL "${fetchUrl}" | bash`;

  store.addAudit(
    router.organizationId,
    req.user!.name,
    req.user!.role,
    'Auto-Provision Token Minted',
    `${router.name} (${router.vendor} · valid 30m)`
  );
  store.save();

  res.status(201).json({
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    filename,
    fetchUrl,
    oneLineCommand,
  });
});

apiRouter.get('/routers/bootstrap/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!/^[a-f0-9]{48}$/.test(token)) {
    res.status(400).type('text/plain').send('# Invalid provisioning token format.\n');
    return;
  }
  const entry = provisionTokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    provisionTokens.delete(token);
    res.status(404).type('text/plain').send('# Provisioning token expired or not found.\n');
    return;
  }

  const router = store.routers.find((r) => r.id === entry.routerId && r.organizationId === entry.organizationId);
  if (!router) {
    res.status(404).type('text/plain').send('# Target router record not found.\n');
    return;
  }

  const site = store.sites.find((s) => s.id === router.siteId);
  const hub = getOrInitWireGuardHub();
  const script = generateRouterAutoScript({
    vendor: router.vendor,
    routerName: router.name,
    model: router.model,
    site,
    wanHost: router.ipAddress,
    apiPort: router.apiPort,
    apiUsername: 'xcloud-api',
    wireguardTunnelIp: router.wireguardTunnelIp,
    wireguardEndpoint: entry.wireguardEndpoint || hub.endpoint,
    wireguardPublicKey: entry.serverPublicKey || hub.publicKey,
    wireguardClientPrivateKey: entry.clientPrivateKey,
    wireguardClientPublicKey: entry.clientPublicKey || router.wireguardPublicKey,
    wireguardPresharedKey: entry.presharedKey,
    radiusSecret: process.env.RADIUS_SECRET?.trim() || undefined,
    bridgeName: router.bridgeName || 'bridge-hotspot',
    bridgePorts: entry.bridgePorts || (router.vendor === 'MikroTik' ? 'ether2,ether3,ether4,wlan1' : 'LAN1,LAN2,WLAN-Hotspot'),
    hotspotSubnet: router.hotspotSubnet || '10.5.50.0/24',
    captivePortalOrigin: entry.origin,
  });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="${script.filename}"`);
  res.type('text/plain; charset=utf-8').send(script.fullScript);
});

// Packages
apiRouter.get('/packages', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ packages: scopeByOrg(store.packages, req.user!) });
});

apiRouter.post('/packages', requireAuth, requireRole('super-admin', 'admin'), (req: AuthenticatedRequest, res) => {
  const { name, durationMinutes, downloadMbps, uploadMbps, dataCapGb, priceTzs, deviceLimit } = req.body ?? {};
  if (!name || !durationMinutes || !priceTzs) {
    res.status(400).json({ error: 'Package name, duration, and price in TZS are required.' });
    return;
  }
  const mins = Number(durationMinutes);
  const label = mins >= 1440 ? `${Math.round(mins / 1440)} Day(s)` : mins >= 60 ? `${Math.round(mins / 60)} Hour(s)` : `${mins} Minutes`;
  const pkg = {
    id: `pkg-${crypto.randomBytes(3).toString('hex')}`,
    organizationId: req.user!.organizationId,
    name: String(name).trim().slice(0, 60),
    durationMinutes: mins,
    durationLabel: label,
    downloadMbps: Number(downloadMbps) || 25,
    uploadMbps: Number(uploadMbps) || 10,
    dataCapGb: dataCapGb ? Number(dataCapGb) : null,
    priceTzs: Number(priceTzs),
    deviceLimit: Number(deviceLimit) || 1,
    active: true,
  };
  store.packages.unshift(pkg);
  store.addAudit(req.user!.organizationId, req.user!.name, req.user!.role, 'Package Created', `${pkg.name} (TZS ${pkg.priceTzs.toLocaleString()})`);
  store.save();
  res.status(201).json({ package: pkg });
});

// Vouchers
apiRouter.get('/vouchers', requireAuth, (req: AuthenticatedRequest, res) => {
  const vouchers = scopeByOrg(store.vouchers, req.user!);
  if (req.user!.role === 'customer') {
    const mine = vouchers.filter((v) => v.redeemedByPhone === req.user!.phone || v.issuedBy.includes(req.user!.name));
    res.json({ vouchers: mine });
    return;
  }
  res.json({ vouchers });
});

apiRouter.post('/vouchers/batch', requireAuth, requireRole('super-admin', 'admin', 'agent'), (req: AuthenticatedRequest, res) => {
  const { siteId, packageId, quantity, customerPhone } = req.body ?? {};
  const count = Math.max(1, Math.min(25, Number(quantity) || 1));
  const orgSites = scopeByOrg(store.sites, req.user!);
  const orgPackages = scopeByOrg(store.packages, req.user!);
  const site = orgSites.find((s) => s.id === siteId) || orgSites[0];
  const pkg = orgPackages.find((p) => p.id === packageId) || orgPackages[0];
  if (!site || !pkg) {
    res.status(400).json({ error: 'At least one hotspot site and one internet package are required before generating vouchers.' });
    return;
  }

  const batchId = `BATCH-${new Date().toISOString().slice(0, 7).replace('-', '')}-${crypto.randomInt(10, 99)}`;

  const created = [];
  for (let i = 0; i < count; i++) {
    const code = generateVoucherCode('TZ');
    const voucher = {
      id: `vch-${crypto.randomBytes(3).toString('hex')}`,
      code,
      batchId,
      organizationId: req.user!.organizationId,
      siteId: site.id,
      siteName: site.name,
      packageId: pkg.id,
      packageName: pkg.name,
      priceTzs: pkg.priceTzs,
      durationMinutes: pkg.durationMinutes,
      status: 'Available' as const,
      issuedBy: `${req.user!.name} (${req.user!.role})`,
      redeemedByPhone: typeof customerPhone === 'string' && customerPhone.trim() ? customerPhone.trim() : undefined,
      createdAt: new Date().toISOString(),
    };
    store.vouchers.unshift(voucher);
    created.push(voucher);

    if (req.user!.role === 'agent') {
      const agent = store.agents.find((a) => a.email === req.user!.email);
      if (agent) {
        const commAmount = Math.round((pkg.priceTzs * agent.commissionRatePercent) / 100);
        agent.vouchersSold += 1;
        agent.totalSalesTzs += pkg.priceTzs;
        agent.pendingPayoutTzs += commAmount;
        store.commissions.unshift({
          id: `com-${crypto.randomBytes(3).toString('hex')}`,
          agentId: agent.id,
          agentName: agent.name,
          voucherCode: code,
          saleAmountTzs: pkg.priceTzs,
          commissionTzs: commAmount,
          status: 'Pending',
          createdAt: new Date().toISOString(),
        });
      }
      store.payments.unshift({
        id: `pay-${crypto.randomBytes(3).toString('hex')}`,
        reference: `CASH-${crypto.randomInt(10000, 99999)}`,
        organizationId: site.organizationId,
        siteId: site.id,
        siteName: site.name,
        packageId: pkg.id,
        packageName: pkg.name,
        customerPhone: typeof customerPhone === 'string' && customerPhone.trim() ? customerPhone.trim() : 'Walk-in Cash',
        provider: 'Cash Agent',
        amountTzs: pkg.priceTzs,
        status: 'Completed',
        voucherCode: code,
        createdAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString(),
      });
    }
  }

  store.addAudit(req.user!.organizationId, req.user!.name, req.user!.role, 'Vouchers Generated', `${count}x ${pkg.name} (${batchId})`);
  store.save();
  res.status(201).json({ vouchers: created, batchId });
});

apiRouter.post('/vouchers/:id/revoke', requireAuth, requireRole('super-admin', 'admin'), (req: AuthenticatedRequest, res) => {
  const voucher = store.vouchers.find((v) => v.id === req.params.id);
  if (!voucher) {
    res.status(404).json({ error: 'Voucher not found.' });
    return;
  }
  if (req.user!.role !== 'super-admin' && voucher.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: 'Cross-organization voucher access denied.' });
    return;
  }
  voucher.status = 'Revoked';
  store.addAudit(voucher.organizationId, req.user!.name, req.user!.role, 'Voucher Revoked', voucher.code);
  store.save();
  res.json({ voucher });
});

// RADIUS Sessions & Real Accounting Updates
apiRouter.get('/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
  let sessions = scopeByOrg(store.sessions, req.user!);

  const orgIdFilter = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
  if (orgIdFilter && orgIdFilter !== 'all' && (req.user!.role === 'super-admin' || req.user!.role === 'support')) {
    sessions = sessions.filter((s) => s.organizationId === orgIdFilter);
  }

  const siteIdFilter = typeof req.query.siteId === 'string' ? req.query.siteId.trim() : '';
  if (siteIdFilter && siteIdFilter !== 'all') {
    sessions = sessions.filter((s) => s.siteId === siteIdFilter);
  }

  const enrichSession = (s: (typeof store.sessions)[number]) => ({
    ...s,
    organizationName: getOrgName(s.organizationId),
  });

  if (req.user!.role === 'customer') {
    const mine = sessions.filter((s) => s.username === req.user!.phone).map(enrichSession);
    res.json({
      sessions: mine,
      serverTime: new Date().toISOString(),
    });
    return;
  }

  res.json({
    sessions: sessions.map(enrichSession),
    serverTime: new Date().toISOString(),
  });
});

apiRouter.post('/radius/accounting', (req, res) => {
  const configuredSecret = process.env.RADIUS_SECRET?.trim();
  const providedSecret = req.header('x-radius-secret')?.trim();
  if (!configuredSecret || !providedSecret) {
    res.status(401).json({ error: 'RADIUS shared secret is required for accounting updates.' });
    return;
  }
  const a = Buffer.from(providedSecret);
  const b = Buffer.from(configuredSecret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid RADIUS shared secret.' });
    return;
  }

  const { voucherCode, macAddress, downloadMb, uploadMb, remainingMinutes, acctStatusType } = req.body ?? {};
  const session = store.sessions.find(
    (s) =>
      s.status === 'Active' &&
      ((typeof voucherCode === 'string' && s.voucherCode === voucherCode.trim().toUpperCase()) ||
        (typeof macAddress === 'string' && s.macAddress.toLowerCase() === macAddress.trim().toLowerCase()))
  );
  if (!session) {
    res.status(404).json({ error: 'Active RADIUS session not found.' });
    return;
  }

  if (typeof downloadMb === 'number' && Number.isFinite(downloadMb) && downloadMb >= 0) {
    session.downloadMb = Number(downloadMb.toFixed(1));
  }
  if (typeof uploadMb === 'number' && Number.isFinite(uploadMb) && uploadMb >= 0) {
    session.uploadMb = Number(uploadMb.toFixed(1));
  }
  if (typeof remainingMinutes === 'number' && Number.isFinite(remainingMinutes) && remainingMinutes >= 0) {
    session.remainingMinutes = Math.round(remainingMinutes);
  }
  if (acctStatusType === 'Stop' || session.remainingMinutes <= 0) {
    session.status = 'Disconnected';
    session.endedAt = new Date().toISOString();
    const site = store.sites.find((st) => st.id === session.siteId);
    if (site && site.activeUsers > 0) site.activeUsers -= 1;
    const router = store.routers.find((rt) => rt.id === session.routerId);
    if (router && router.activeLeases > 0) router.activeLeases -= 1;
  }
  store.save();
  res.json({
    ok: true,
    session: { ...session, organizationName: getOrgName(session.organizationId) },
  });
});

apiRouter.post('/sessions/:id/disconnect', requireAuth, requireRole('super-admin', 'admin', 'support', 'customer'), (req: AuthenticatedRequest, res) => {
  const session = store.sessions.find((s) => s.id === req.params.id);
  if (!session) {
    res.status(404).json({ error: 'RADIUS session not found.' });
    return;
  }
  if (req.user!.role !== 'super-admin' && req.user!.role !== 'support' && session.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: 'Cross-organization session access denied.' });
    return;
  }
  if (req.user!.role === 'customer' && session.username !== req.user!.phone) {
    res.status(403).json({ error: 'You may only disconnect your own WiFi session.' });
    return;
  }
  if (session.status === 'Active') {
    session.status = 'Disconnected';
    session.remainingMinutes = 0;
    session.endedAt = new Date().toISOString();
    const site = store.sites.find((st) => st.id === session.siteId);
    if (site && site.activeUsers > 0) site.activeUsers -= 1;
    const router = store.routers.find((rt) => rt.id === session.routerId);
    if (router && router.activeLeases > 0) router.activeLeases -= 1;
    store.addAudit(session.organizationId, req.user!.name, req.user!.role, 'RADIUS CoA Disconnect', `${session.voucherCode} (${session.macAddress})`);
    store.save();
  }
  res.json({
    session: { ...session, organizationName: getOrgName(session.organizationId) },
  });
});

// Payments & Authenticated Operator Reconciliation
apiRouter.get('/payments', requireAuth, (req: AuthenticatedRequest, res) => {
  const payments = scopeByOrg(store.payments, req.user!);
  if (req.user!.role === 'customer') {
    const mine = payments.filter((p) => p.customerPhone === req.user!.phone);
    res.json({ payments: mine });
    return;
  }
  res.json({ payments });
});

apiRouter.post('/payments/:reference/verify', requireAuth, requireRole('super-admin', 'admin'), (req: AuthenticatedRequest, res) => {
  const tx = store.payments.find((p) => p.reference === req.params.reference);
  if (!tx) {
    res.status(404).json({ error: 'Payment reference not found.' });
    return;
  }
  if (req.user!.role !== 'super-admin' && tx.organizationId !== req.user!.organizationId) {
    res.status(403).json({ error: 'Cross-organization payment access denied.' });
    return;
  }
  try {
    const result = settleDalipayPayment(tx.reference);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to settle payment.' });
  }
});

// Payment Gateways Configuration (Merchant Routing & Server Secret Readiness)
apiRouter.get('/gateways', requireAuth, requireRole('super-admin', 'admin'), (req: AuthenticatedRequest, res) => {
  const requestedOrgId = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
  const targetOrgId =
    req.user!.role === 'super-admin' &&
    requestedOrgId &&
    store.organizations.some((o) => o.id === requestedOrgId)
      ? requestedOrgId
      : req.user!.organizationId;

  res.json({
    organizationId: targetOrgId,
    gateways: getOrganizationGateways(targetOrgId),
  });
});

apiRouter.patch('/gateways/:code', requireAuth, requireRole('super-admin', 'admin'), (req: AuthenticatedRequest, res) => {
  const gatewayCodeParam = req.params.code;
  if (!isValidGatewayCode(gatewayCodeParam)) {
    res.status(400).json({ error: 'Unsupported payment gateway code.' });
    return;
  }

  const { enabled, merchantShortcode, accountName, organizationId } = req.body ?? {};
  const targetOrgId =
    req.user!.role === 'super-admin' &&
    typeof organizationId === 'string' &&
    store.organizations.some((o) => o.id === organizationId.trim())
      ? organizationId.trim()
      : req.user!.organizationId;

  const updated = upsertOrganizationGateway({
    organizationId: targetOrgId,
    code: gatewayCodeParam,
    enabled: typeof enabled === 'boolean' ? enabled : undefined,
    merchantShortcode: typeof merchantShortcode === 'string' ? merchantShortcode : undefined,
    accountName: typeof accountName === 'string' ? accountName : undefined,
  });

  store.addAudit(
    targetOrgId,
    req.user!.name,
    req.user!.role,
    'Payment Gateway Updated',
    `${updated.name} -> ${updated.enabled ? 'Enabled' : 'Disabled'}${updated.merchantShortcode ? ` (${updated.merchantShortcode})` : ''}`
  );
  store.save();

  res.json({ gateway: updated });
});

// Agents & Commissions
apiRouter.get('/agents', requireAuth, requireRole('super-admin', 'admin', 'agent'), (req: AuthenticatedRequest, res) => {
  const orgAgents = scopeByOrg(store.agents, req.user!);
  const agentIds = new Set(orgAgents.map((a) => a.id));
  res.json({
    agents: orgAgents,
    commissions: req.user!.role === 'super-admin' ? store.commissions : store.commissions.filter((c) => agentIds.has(c.agentId)),
  });
});

apiRouter.post('/commissions/:id/payout', requireAuth, requireRole('super-admin', 'admin'), (req: AuthenticatedRequest, res) => {
  const entry = store.commissions.find((c) => c.id === req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Commission entry not found.' });
    return;
  }
  if (entry.status === 'Paid') {
    res.json({ commission: entry });
    return;
  }
  entry.status = 'Paid';
  entry.paidAt = new Date().toISOString();
  const agent = store.agents.find((a) => a.id === entry.agentId);
  if (agent) {
    agent.pendingPayoutTzs = Math.max(0, agent.pendingPayoutTzs - entry.commissionTzs);
    agent.paidOutTzs += entry.commissionTzs;
  }
  store.addAudit(req.user!.organizationId, req.user!.name, req.user!.role, 'Agent Commission Paid', `${entry.agentName} · TZS ${entry.commissionTzs.toLocaleString()}`);
  store.save();
  res.json({ commission: entry });
});

// Support Tickets
apiRouter.get('/tickets', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ tickets: scopeByOrg(store.tickets, req.user!) });
});

apiRouter.post('/tickets', requireAuth, (req: AuthenticatedRequest, res) => {
  const { subject, category, priority, siteName, message } = req.body ?? {};
  if (!subject || typeof subject !== 'string') {
    res.status(400).json({ error: 'Ticket subject is required.' });
    return;
  }
  const orgSite = scopeByOrg(store.sites, req.user!)[0];
  const ticket = {
    id: `tkt-${crypto.randomInt(400, 999)}`,
    organizationId: req.user!.organizationId,
    siteName: String(siteName || orgSite?.name || 'General Network'),
    customerName: req.user!.name,
    customerContact: req.user!.phone || req.user!.email,
    subject: subject.trim().slice(0, 140),
    category: (['Connectivity', 'DaliPay Payment', 'Voucher Issue', 'Router Hardware'].includes(category)
      ? category
      : 'Connectivity') as 'Connectivity' | 'DaliPay Payment' | 'Voucher Issue' | 'Router Hardware',
    priority: (['Normal', 'High', 'Urgent'].includes(priority) ? priority : 'Normal') as 'Normal' | 'High' | 'Urgent',
    status: 'Open' as const,
    lastReply: typeof message === 'string' && message.trim() ? message.trim() : 'Ticket logged and queued for NOC review.',
    createdAt: new Date().toISOString(),
  };
  store.tickets.unshift(ticket);
  store.addAudit(req.user!.organizationId, req.user!.name, req.user!.role, 'Support Ticket Opened', ticket.id);
  store.save();
  res.status(201).json({ ticket });
});

apiRouter.patch('/tickets/:id', requireAuth, requireRole('super-admin', 'admin', 'support'), (req: AuthenticatedRequest, res) => {
  const ticket = store.tickets.find((t) => t.id === req.params.id);
  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found.' });
    return;
  }
  const { status, reply } = req.body ?? {};
  if (['Open', 'In Progress', 'Resolved'].includes(status)) {
    ticket.status = status;
  }
  if (typeof reply === 'string' && reply.trim()) {
    ticket.lastReply = reply.trim().slice(0, 400);
  }
  store.addAudit(ticket.organizationId, req.user!.name, req.user!.role, 'Ticket Updated', `${ticket.id} -> ${ticket.status}`);
  store.save();
  res.json({ ticket });
});

// Audit Logs & Background Workers
apiRouter.get('/audit-logs', requireAuth, requireRole('super-admin', 'admin', 'support'), (req: AuthenticatedRequest, res) => {
  res.json({ auditLogs: scopeByOrg(store.auditLogs, req.user!) });
});

apiRouter.get('/worker/status', requireAuth, requireRole('super-admin', 'admin', 'support'), (_req, res) => {
  res.json({ jobs: store.workerJobs });
});

apiRouter.post('/worker/run', requireAuth, requireRole('super-admin', 'admin'), async (req: AuthenticatedRequest, res) => {
  const { jobKey } = req.body ?? {};
  const target = typeof jobKey === 'string' ? jobKey : 'all';
  if (target === 'all' || target === 'notifications') {
    await runRouterHealthSweep();
  }
  const jobs = runWorkerCycle(target);
  store.addAudit(req.user!.organizationId, req.user!.name, req.user!.role, 'Worker Cycle Executed', target);
  store.save();
  res.json({ jobs });
});

// Router Offline & Critical Error Email Alerts
apiRouter.get('/alerts/config', requireAuth, requireRole('super-admin', 'admin', 'support'), (req: AuthenticatedRequest, res) => {
  const requestedOrgId = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
  const targetOrgId =
    (req.user!.role === 'super-admin' || req.user!.role === 'support') &&
    requestedOrgId &&
    store.organizations.some((o) => o.id === requestedOrgId)
      ? requestedOrgId
      : req.user!.organizationId;

  const logs = scopeByOrg(store.alertLogs, req.user!)
    .filter((l) => (req.user!.role === 'super-admin' && requestedOrgId && requestedOrgId !== 'all' ? l.organizationId === targetOrgId : true))
    .map((l) => ({ ...l, organizationName: getOrgName(l.organizationId) }));

  res.json({
    organizationId: targetOrgId,
    setting: getRouterAlertSetting(targetOrgId),
    defaultRecipients: getDefaultAdminRecipients(targetOrgId),
    transport: getEmailTransportStatus(),
    logs,
  });
});

apiRouter.patch('/alerts/config', requireAuth, requireRole('super-admin', 'admin'), (req: AuthenticatedRequest, res) => {
  const {
    organizationId,
    enabled,
    recipientEmails,
    notifyOnOffline,
    notifyOnCriticalError,
    notifyOnRecovery,
    cpuCriticalThreshold,
    memoryCriticalThreshold,
    cooldownMinutes,
  } = req.body ?? {};

  const targetOrgId =
    req.user!.role === 'super-admin' &&
    typeof organizationId === 'string' &&
    store.organizations.some((o) => o.id === organizationId.trim())
      ? organizationId.trim()
      : req.user!.organizationId;

  if (Array.isArray(recipientEmails)) {
    const invalid = recipientEmails.filter((e) => typeof e === 'string' && e.trim().length > 0 && !isValidEmail(e));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Invalid administrator email address: ${String(invalid[0])}` });
      return;
    }
  }

  const setting = upsertRouterAlertSetting({
    organizationId: targetOrgId,
    enabled: typeof enabled === 'boolean' ? enabled : undefined,
    recipientEmails: Array.isArray(recipientEmails) ? recipientEmails.map((e) => String(e)) : undefined,
    notifyOnOffline: typeof notifyOnOffline === 'boolean' ? notifyOnOffline : undefined,
    notifyOnCriticalError: typeof notifyOnCriticalError === 'boolean' ? notifyOnCriticalError : undefined,
    notifyOnRecovery: typeof notifyOnRecovery === 'boolean' ? notifyOnRecovery : undefined,
    cpuCriticalThreshold: typeof cpuCriticalThreshold === 'number' ? cpuCriticalThreshold : Number(cpuCriticalThreshold),
    memoryCriticalThreshold:
      typeof memoryCriticalThreshold === 'number' ? memoryCriticalThreshold : Number(memoryCriticalThreshold),
    cooldownMinutes: typeof cooldownMinutes === 'number' ? cooldownMinutes : Number(cooldownMinutes),
  });

  store.addAudit(
    targetOrgId,
    req.user!.name,
    req.user!.role,
    'Router Alert Policy Updated',
    `${setting.enabled ? 'Enabled' : 'Paused'} · ${setting.recipientEmails.length} admin recipient(s)`
  );
  store.save();

  res.json({
    setting,
    defaultRecipients: getDefaultAdminRecipients(targetOrgId),
    transport: getEmailTransportStatus(),
  });
});

apiRouter.post('/alerts/test', requireAuth, requireRole('super-admin', 'admin', 'support'), async (req: AuthenticatedRequest, res) => {
  const { routerId, organizationId, triggerType } = req.body ?? {};
  const scopedRouters = scopeByOrg(store.routers, req.user!);
  const router =
    (typeof routerId === 'string' && scopedRouters.find((r) => r.id === routerId)) ||
    (typeof organizationId === 'string' && scopedRouters.find((r) => r.organizationId === organizationId)) ||
    scopedRouters[0];

  if (!router) {
    res.status(400).json({ error: 'Register at least one MikroTik or Omada router before sending a test alert.' });
    return;
  }

  const normalizedTrigger =
    triggerType === 'router_critical_error' ? 'router_critical_error' : 'router_offline';

  const summary =
    normalizedTrigger === 'router_critical_error'
      ? `Diagnostic test: critical error alert check for ${router.vendor} router ${router.name} (${router.siteName}).`
      : `Diagnostic test: offline alert check for ${router.vendor} router ${router.name} (${router.siteName}).`;

  const logEntry = await dispatchRouterAlertEmail({
    router,
    triggerType: normalizedTrigger,
    severity: 'Critical',
    summary,
    errorDetail: 'Triggered manually from XCLOUD.NET Router Alerts console.',
    isTest: true,
  });

  res.status(logEntry.deliveryStatus === 'Failed' ? 502 : 200).json({
    log: logEntry,
    transport: getEmailTransportStatus(),
  });
});

