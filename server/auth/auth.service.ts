import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { PublicUser, UserRole } from '../../packages/shared/types.ts';
import { hashPassword, store, verifyPassword } from '../db/store.ts';

const SESSION_SIGNING_KEY = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  phone?: string;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user?: PublicUser;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function issueToken(user: PublicUser): string {
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    phone: user.phone,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SIGNING_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string): PublicUser | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SIGNING_KEY).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as TokenPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return {
      id: parsed.sub,
      email: parsed.email,
      name: parsed.name,
      role: parsed.role,
      organizationId: parsed.organizationId,
      organizationName: parsed.organizationName,
      phone: parsed.phone,
    };
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Session expired or invalid token.' });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role permissions for this operation.' });
      return;
    }
    next();
  };
}

export function getAdminBootstrapStatus() {
  const envConfigured = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
  return {
    envPasscodeConfigured: envConfigured,
    adminClaimed: envConfigured || store.adminClaim !== null,
    claimedEmail: store.adminClaim?.email || (envConfigured ? 'superadmin@xcloud.net' : null),
  };
}

export function claimSuperAdmin(name: string, email: string, password: string) {
  const status = getAdminBootstrapStatus();
  if (status.adminClaimed) {
    throw new Error('Super Admin credentials are already configured.');
  }
  if (store.organizations.length === 0) {
    store.organizations.push({
      id: 'org-primary',
      name: 'XCLOUD.NET Tanzania Platform',
      slug: 'xcloud-tanzania',
      plan: 'Carrier Multi-Tenant',
      status: 'Active',
      country: 'Tanzania',
      currency: 'TZS',
      siteLimit: 100,
      routerLimit: 250,
      monthlyRevenueTzs: 0,
      createdAt: new Date().toISOString(),
    });
  }
  const primaryOrg = store.organizations[0];
  const { salt, hash } = hashPassword(password);
  store.adminClaim = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    salt,
    hash,
  };
  const user: PublicUser = {
    id: 'usr-super-admin',
    email: store.adminClaim.email,
    name: store.adminClaim.name,
    role: 'super-admin',
    organizationId: primaryOrg.id,
    organizationName: primaryOrg.name,
  };
  store.addAudit(primaryOrg.id, user.name, 'super-admin', 'Super Admin Claimed', user.email);
  store.save();
  return { user, token: issueToken(user) };
}

export function verifySuperAdminLogin(email: string, password: string): PublicUser | null {
  const primaryOrg = store.organizations[0];
  const orgId = primaryOrg?.id || 'org-primary';
  const orgName = primaryOrg?.name || 'XCLOUD.NET Tanzania Platform';

  const envPasscode = process.env.ADMIN_PASSCODE?.trim();
  if (envPasscode && envPasscode.length > 0) {
    const a = Buffer.from(password);
    const b = Buffer.from(envPasscode);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return {
        id: 'usr-super-admin',
        email: email.trim().toLowerCase() || 'superadmin@xcloud.co.tz',
        name: 'Platform Super Admin',
        role: 'super-admin',
        organizationId: orgId,
        organizationName: orgName,
      };
    }
    return null;
  }

  if (store.adminClaim) {
    if (email.trim().toLowerCase() === store.adminClaim.email && verifyPassword(password, store.adminClaim.salt, store.adminClaim.hash)) {
      return {
        id: 'usr-super-admin',
        email: store.adminClaim.email,
        name: store.adminClaim.name,
        role: 'super-admin',
        organizationId: orgId,
        organizationName: orgName,
      };
    }
  }
  return null;
}

export function getOrgName(orgId: string): string {
  return store.organizations.find((o) => o.id === orgId)?.name || 'XCLOUD.NET Partner';
}
