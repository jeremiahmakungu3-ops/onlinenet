export type UserRole = 'super-admin' | 'admin' | 'agent' | 'customer' | 'support';

export type RouterVendor = 'MikroTik' | 'Omada';
export type OnlineStatus = 'Online' | 'Degraded' | 'Offline';
export type VoucherStatus = 'Available' | 'Active' | 'Used' | 'Expired' | 'Revoked';
export type PaymentStatus = 'Pending' | 'Completed' | 'Failed' | 'Refunded';
export type TicketStatus = 'Open' | 'In Progress' | 'Resolved';
export type TicketPriority = 'Normal' | 'High' | 'Urgent';

export type DalipayProvider =
  | 'DaliPay M-Pesa'
  | 'DaliPay Tigo Pesa'
  | 'DaliPay Airtel Money'
  | 'DaliPay Halopesa'
  | 'Vodacom M-Pesa'
  | 'Tigo Pesa'
  | 'Airtel Money'
  | 'Selcom Pay'
  | 'AzamPay';

export type PaymentGatewayCode =
  | 'dalipay'
  | 'mpesa_tz'
  | 'tigopesa_tz'
  | 'airtelmoney_tz'
  | 'selcom_tz'
  | 'azampay_tz';

export interface StoredGatewaySetting {
  id: string;
  organizationId: string;
  code: PaymentGatewayCode;
  enabled: boolean;
  merchantShortcode: string;
  accountName: string;
  updatedAt: string;
}

export interface PaymentGatewayConfig extends StoredGatewaySetting {
  name: string;
  providerLabel: string;
  channels: string[];
  webhookPath: string;
  credentialsConfigured: boolean;
  webhookSecretConfigured: boolean;
  requiredEnvVars: string[];
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  phone?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: 'Starter' | 'Regional ISP' | 'Carrier Multi-Tenant';
  status: 'Active' | 'Suspended';
  country: string;
  currency: string;
  siteLimit: number;
  routerLimit: number;
  monthlyRevenueTzs: number;
  createdAt: string;
}

export interface Site {
  id: string;
  organizationId: string;
  name: string;
  location: string;
  ssid: string;
  captivePortalTitle: string;
  activeUsers: number;
  status: 'Active' | 'Maintenance';
  hotspotEnabled: boolean;
  voucherPdfEnabled: boolean;
  walledGardenHosts: string[];
}

export interface RouterDevice {
  id: string;
  organizationId: string;
  organizationName?: string;
  siteId: string;
  siteName: string;
  name: string;
  vendor: RouterVendor;
  model: string;
  ipAddress: string;
  wireguardTunnelIp: string;
  wireguardPublicKey?: string;
  apiPort: number;
  bridgeName?: string;
  hotspotSubnet?: string;
  status: OnlineStatus;
  latencyMs?: number | null;
  cpuPercent: number;
  memoryPercent: number;
  activeLeases: number;
  uptime: string;
  lastError?: string | null;
  lastSyncedAt: string;
}

export interface HotspotPackage {
  id: string;
  organizationId: string;
  name: string;
  durationMinutes: number;
  durationLabel: string;
  downloadMbps: number;
  uploadMbps: number;
  dataCapGb: number | null;
  priceTzs: number;
  deviceLimit: number;
  active: boolean;
}

export interface Voucher {
  id: string;
  code: string;
  batchId: string;
  organizationId: string;
  siteId: string;
  siteName: string;
  packageId: string;
  packageName: string;
  priceTzs: number;
  durationMinutes: number;
  status: VoucherStatus;
  issuedBy: string;
  redeemedByPhone?: string;
  redeemedMac?: string;
  createdAt: string;
  activatedAt?: string;
  expiresAt?: string;
}

export interface PaymentTransaction {
  id: string;
  reference: string;
  organizationId: string;
  siteId: string;
  siteName: string;
  packageId: string;
  packageName: string;
  customerPhone: string;
  gatewayCode?: PaymentGatewayCode;
  provider: DalipayProvider | 'Cash Agent';
  amountTzs: number;
  status: PaymentStatus;
  voucherCode?: string;
  createdAt: string;
  verifiedAt?: string;
}

export interface RadiusSession {
  id: string;
  organizationId: string;
  organizationName?: string;
  siteId: string;
  siteName: string;
  routerId: string;
  routerName: string;
  username: string;
  voucherCode: string;
  macAddress: string;
  framedIp: string;
  downloadMb: number;
  uploadMb: number;
  remainingMinutes: number;
  status: 'Active' | 'Disconnected';
  startedAt: string;
  endedAt?: string;
}

export interface AgentRecord {
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  email: string;
  siteName: string;
  commissionRatePercent: number;
  vouchersSold: number;
  totalSalesTzs: number;
  pendingPayoutTzs: number;
  paidOutTzs: number;
  status: 'Active' | 'Paused';
}

export interface CommissionEntry {
  id: string;
  agentId: string;
  agentName: string;
  voucherCode: string;
  saleAmountTzs: number;
  commissionTzs: number;
  status: 'Pending' | 'Paid';
  createdAt: string;
  paidAt?: string;
}

export interface SupportTicket {
  id: string;
  organizationId: string;
  siteName: string;
  customerName: string;
  customerContact: string;
  subject: string;
  category: 'Connectivity' | 'DaliPay Payment' | 'Voucher Issue' | 'Router Hardware';
  priority: TicketPriority;
  status: TicketStatus;
  lastReply: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  actorName: string;
  actorRole: UserRole | 'system';
  action: string;
  target: string;
  timestamp: string;
}

export interface WorkerJobState {
  name: string;
  key: 'payment-verification' | 'voucher-expiration' | 'session-disconnection' | 'usage-accounting' | 'notifications';
  lastRunAt: string;
  processedCount: number;
  summary: string;
}

export interface LeadSubmission {
  id: string;
  name: string;
  email: string;
  company: string;
  sitesCount: string;
  message: string;
  createdAt: string;
}

export interface DailyMetricPoint {
  date: string;
  revenueTzs: number;
  activeSessions: number;
}

export type AlertTriggerType = 'router_offline' | 'router_critical_error' | 'router_recovered';
export type AlertDeliveryStatus = 'Sent' | 'Failed' | 'Skipped';
export type AlertSeverity = 'Critical' | 'Warning' | 'Resolved';

export interface RouterAlertSetting {
  organizationId: string;
  enabled: boolean;
  recipientEmails: string[];
  notifyOnOffline: boolean;
  notifyOnCriticalError: boolean;
  notifyOnRecovery: boolean;
  cpuCriticalThreshold: number;
  memoryCriticalThreshold: number;
  cooldownMinutes: number;
  updatedAt: string;
}

export interface AlertEmailLog {
  id: string;
  organizationId: string;
  organizationName?: string;
  routerId: string;
  routerName: string;
  vendor: RouterVendor;
  siteName: string;
  triggerType: AlertTriggerType;
  severity: AlertSeverity;
  recipients: string[];
  subject: string;
  summary: string;
  deliveryStatus: AlertDeliveryStatus;
  provider: 'SMTP' | 'Resend' | 'Unconfigured';
  providerMessageId?: string;
  errorDetail?: string;
  createdAt: string;
}

export interface EmailTransportStatus {
  configured: boolean;
  provider: 'SMTP' | 'Resend' | 'Unconfigured';
  fromEmail: string;
  smtpHost?: string;
  smtpPort?: number;
}
