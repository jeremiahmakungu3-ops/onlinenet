import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  AlertEmailLog,
  AgentRecord,
  AuditLogEntry,
  CommissionEntry,
  HotspotPackage,
  LeadSubmission,
  Organization,
  PaymentTransaction,
  RadiusSession,
  RouterAlertSetting,
  RouterDevice,
  Site,
  StoredGatewaySetting,
  SupportTicket,
  UserRole,
  Voucher,
  WorkerJobState,
} from '../../packages/shared/types.ts';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  phone?: string;
  passwordSalt: string;
  passwordHash: string;
}

export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, usedSalt, 64).toString('hex');
  return { salt: usedSalt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

const DATA_FILE_PATH = path.resolve(process.cwd(), 'server/db/xcloud-data.json');

function defaultWorkerJobs(): WorkerJobState[] {
  const now = new Date().toISOString();
  return [
    {
      name: 'Payment Verification Worker',
      key: 'payment-verification',
      lastRunAt: now,
      processedCount: 0,
      summary: 'Awaiting DaliPay collection transactions.',
    },
    {
      name: 'Voucher Expiration Worker',
      key: 'voucher-expiration',
      lastRunAt: now,
      processedCount: 0,
      summary: 'Ready to expire elapsed active vouchers.',
    },
    {
      name: 'RADIUS Session Disconnection',
      key: 'session-disconnection',
      lastRunAt: now,
      processedCount: 0,
      summary: 'Ready to enforce CoA disconnects on expired sessions.',
    },
    {
      name: 'Usage Accounting Aggregator',
      key: 'usage-accounting',
      lastRunAt: now,
      processedCount: 0,
      summary: 'Ready to aggregate FreeRADIUS Acct-Interim-Update traffic.',
    },
    {
      name: 'Notification Dispatcher',
      key: 'notifications',
      lastRunAt: now,
      processedCount: 0,
      summary: 'Monitoring urgent NOC tickets and gateway alerts.',
    },
  ];
}

interface PersistedSnapshot {
  adminClaim: { hash: string; salt: string; email: string; name: string } | null;
  users: StoredUser[];
  organizations: Organization[];
  sites: Site[];
  routers: RouterDevice[];
  packages: HotspotPackage[];
  vouchers: Voucher[];
  payments: PaymentTransaction[];
  sessions: RadiusSession[];
  agents: AgentRecord[];
  commissions: CommissionEntry[];
  tickets: SupportTicket[];
  auditLogs: AuditLogEntry[];
  leads: LeadSubmission[];
  paymentGateways: StoredGatewaySetting[];
  alertSettings: RouterAlertSetting[];
  alertLogs: AlertEmailLog[];
  workerJobs: WorkerJobState[];
  wireguardHub: { publicKey: string; endpoint: string } | null;
}

class XCloudStore {
  public adminClaim: { hash: string; salt: string; email: string; name: string } | null = null;
  public users: StoredUser[] = [];
  public organizations: Organization[] = [];
  public sites: Site[] = [];
  public routers: RouterDevice[] = [];
  public packages: HotspotPackage[] = [];
  public vouchers: Voucher[] = [];
  public payments: PaymentTransaction[] = [];
  public sessions: RadiusSession[] = [];
  public agents: AgentRecord[] = [];
  public commissions: CommissionEntry[] = [];
  public tickets: SupportTicket[] = [];
  public auditLogs: AuditLogEntry[] = [];
  public leads: LeadSubmission[] = [];
  public paymentGateways: StoredGatewaySetting[] = [];
  public alertSettings: RouterAlertSetting[] = [];
  public alertLogs: AlertEmailLog[] = [];
  public resetTokens: Map<string, { email: string; expiresAt: number }> = new Map();
  public workerJobs: WorkerJobState[] = defaultWorkerJobs();
  public wireguardHub: { publicKey: string; endpoint: string } | null = null;

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(DATA_FILE_PATH)) return;
      const raw = fs.readFileSync(DATA_FILE_PATH, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Partial<PersistedSnapshot>;
      this.adminClaim = parsed.adminClaim ?? null;
      this.users = Array.isArray(parsed.users) ? parsed.users : [];
      this.organizations = Array.isArray(parsed.organizations) ? parsed.organizations : [];
      this.sites = Array.isArray(parsed.sites) ? parsed.sites : [];
      this.routers = Array.isArray(parsed.routers) ? parsed.routers : [];
      this.packages = Array.isArray(parsed.packages) ? parsed.packages : [];
      this.vouchers = Array.isArray(parsed.vouchers) ? parsed.vouchers : [];
      this.payments = Array.isArray(parsed.payments) ? parsed.payments : [];
      this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      this.agents = Array.isArray(parsed.agents) ? parsed.agents : [];
      this.commissions = Array.isArray(parsed.commissions) ? parsed.commissions : [];
      this.tickets = Array.isArray(parsed.tickets) ? parsed.tickets : [];
      this.auditLogs = Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [];
      this.leads = Array.isArray(parsed.leads) ? parsed.leads : [];
      this.paymentGateways = Array.isArray(parsed.paymentGateways) ? parsed.paymentGateways : [];
      this.alertSettings = Array.isArray(parsed.alertSettings) ? parsed.alertSettings : [];
      this.alertLogs = Array.isArray(parsed.alertLogs) ? parsed.alertLogs : [];
      this.workerJobs =
        Array.isArray(parsed.workerJobs) && parsed.workerJobs.length > 0 ? parsed.workerJobs : defaultWorkerJobs();
      this.wireguardHub = parsed.wireguardHub ?? null;
    } catch (err) {
      console.error('Failed to load persisted store data:', err);
    }
  }

  public save() {
    try {
      const dir = path.dirname(DATA_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const snapshot: PersistedSnapshot = {
        adminClaim: this.adminClaim,
        users: this.users,
        organizations: this.organizations,
        sites: this.sites,
        routers: this.routers,
        packages: this.packages,
        vouchers: this.vouchers,
        payments: this.payments,
        sessions: this.sessions,
        agents: this.agents,
        commissions: this.commissions,
        tickets: this.tickets,
        auditLogs: this.auditLogs,
        leads: this.leads,
        paymentGateways: this.paymentGateways,
        alertSettings: this.alertSettings,
        alertLogs: this.alertLogs,
        workerJobs: this.workerJobs,
        wireguardHub: this.wireguardHub,
      };
      const tmpPath = `${DATA_FILE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
      fs.renameSync(tmpPath, DATA_FILE_PATH);
    } catch (err) {
      console.error('Failed to persist store data:', err);
    }
  }

  public addAudit(
    organizationId: string,
    actorName: string,
    actorRole: UserRole | 'system',
    action: string,
    target: string
  ) {
    this.auditLogs.unshift({
      id: `aud-${crypto.randomBytes(4).toString('hex')}`,
      organizationId,
      actorName,
      actorRole,
      action,
      target,
      timestamp: new Date().toISOString(),
    });
    if (this.auditLogs.length > 100) {
      this.auditLogs.length = 100;
    }
    this.save();
  }
}

export const store = new XCloudStore();
