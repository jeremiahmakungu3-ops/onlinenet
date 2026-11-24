import crypto from 'crypto';
import nodemailer from 'nodemailer';
import type {
  AlertEmailLog,
  AlertSeverity,
  AlertTriggerType,
  EmailTransportStatus,
  OnlineStatus,
  RouterAlertSetting,
  RouterDevice,
} from '../../packages/shared/types.ts';
import { store } from '../db/store.ts';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const lastAlertSentAt = new Map<string, number>();
const activeIncidentRouters = new Set<string>();

export function isValidEmail(email: string): boolean {
  const clean = email.trim();
  return clean.length >= 5 && clean.length <= 160 && EMAIL_REGEX.test(clean);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getOrgNameSafe(organizationId: string): string {
  return store.organizations.find((o) => o.id === organizationId)?.name || 'XCLOUD.NET Tenant';
}

export function getEmailTransportStatus(): EmailTransportStatus {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const fromEmail =
    process.env.ALERT_FROM_EMAIL?.trim() ||
    process.env.SMTP_USER?.trim() ||
    'alerts@xcloud.co.tz';

  if (resendKey) {
    return {
      configured: true,
      provider: 'Resend',
      fromEmail,
    };
  }

  if (smtpHost) {
    return {
      configured: true,
      provider: 'SMTP',
      fromEmail,
      smtpHost,
      smtpPort,
    };
  }

  return {
    configured: false,
    provider: 'Unconfigured',
    fromEmail,
  };
}

export function getDefaultAdminRecipients(organizationId: string): string[] {
  const emails = new Set<string>();

  for (const u of store.users) {
    if ((u.role === 'super-admin' || (u.role === 'admin' && u.organizationId === organizationId)) && isValidEmail(u.email)) {
      emails.add(u.email.trim().toLowerCase());
    }
  }

  if (store.adminClaim?.email && isValidEmail(store.adminClaim.email)) {
    emails.add(store.adminClaim.email.trim().toLowerCase());
  }

  return Array.from(emails);
}

export function getRouterAlertSetting(organizationId: string): RouterAlertSetting {
  const existing = store.alertSettings.find((s) => s.organizationId === organizationId);
  if (existing) {
    return existing;
  }

  return {
    organizationId,
    enabled: true,
    recipientEmails: getDefaultAdminRecipients(organizationId),
    notifyOnOffline: true,
    notifyOnCriticalError: true,
    notifyOnRecovery: true,
    cpuCriticalThreshold: 90,
    memoryCriticalThreshold: 92,
    cooldownMinutes: 15,
    updatedAt: new Date().toISOString(),
  };
}

export function upsertRouterAlertSetting(params: {
  organizationId: string;
  enabled?: boolean;
  recipientEmails?: string[];
  notifyOnOffline?: boolean;
  notifyOnCriticalError?: boolean;
  notifyOnRecovery?: boolean;
  cpuCriticalThreshold?: number;
  memoryCriticalThreshold?: number;
  cooldownMinutes?: number;
}): RouterAlertSetting {
  let setting = store.alertSettings.find((s) => s.organizationId === params.organizationId);
  if (!setting) {
    setting = getRouterAlertSetting(params.organizationId);
    store.alertSettings.push(setting);
  }

  if (typeof params.enabled === 'boolean') setting.enabled = params.enabled;
  if (Array.isArray(params.recipientEmails)) {
    setting.recipientEmails = Array.from(
      new Set(
        params.recipientEmails
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => isValidEmail(e))
      )
    ).slice(0, 20);
  }
  if (typeof params.notifyOnOffline === 'boolean') setting.notifyOnOffline = params.notifyOnOffline;
  if (typeof params.notifyOnCriticalError === 'boolean') setting.notifyOnCriticalError = params.notifyOnCriticalError;
  if (typeof params.notifyOnRecovery === 'boolean') setting.notifyOnRecovery = params.notifyOnRecovery;
  if (typeof params.cpuCriticalThreshold === 'number' && Number.isFinite(params.cpuCriticalThreshold)) {
    setting.cpuCriticalThreshold = Math.max(50, Math.min(100, Math.round(params.cpuCriticalThreshold)));
  }
  if (typeof params.memoryCriticalThreshold === 'number' && Number.isFinite(params.memoryCriticalThreshold)) {
    setting.memoryCriticalThreshold = Math.max(50, Math.min(100, Math.round(params.memoryCriticalThreshold)));
  }
  if (typeof params.cooldownMinutes === 'number' && Number.isFinite(params.cooldownMinutes)) {
    setting.cooldownMinutes = Math.max(1, Math.min(1440, Math.round(params.cooldownMinutes)));
  }
  setting.updatedAt = new Date().toISOString();
  store.save();
  return setting;
}

function buildEmailContent(params: {
  router: RouterDevice;
  orgName: string;
  triggerType: AlertTriggerType;
  severity: AlertSeverity;
  summary: string;
  errorDetail?: string | null;
  isTest?: boolean;
}): { subject: string; text: string; html: string } {
  const { router, orgName, triggerType, severity, summary, errorDetail, isTest } = params;
  const tag = isTest ? '[TEST ALERT] ' : '';
  const triggerLabel =
    triggerType === 'router_offline'
      ? 'ROUTER OFFLINE'
      : triggerType === 'router_critical_error'
      ? 'CRITICAL ERROR'
      : 'RECOVERED';

  const subject = `${tag}[${triggerLabel}] ${router.vendor} ${router.name} (${router.siteName})`;
  const dashboardUrl = process.env.APP_URL?.trim() || 'https://portal.xcloud.co.tz';
  const timestamp = new Date().toISOString();

  const text = [
    `XCLOUD.NET Router Alert (${severity})`,
    `----------------------------------------`,
    `Event: ${triggerLabel}${isTest ? ' (Diagnostic Test)' : ''}`,
    `Tenant: ${orgName}`,
    `Site: ${router.siteName}`,
    `Router: ${router.name} (${router.vendor} · ${router.model})`,
    `Endpoint: ${router.ipAddress}:${router.apiPort}`,
    `WireGuard Tunnel: ${router.wireguardTunnelIp}`,
    `Status: ${router.status}`,
    `CPU / Memory: ${router.cpuPercent}% / ${router.memoryPercent}%`,
    `Active Leases: ${router.activeLeases}`,
    `Summary: ${summary}`,
    errorDetail ? `Diagnostic Detail: ${errorDetail}` : '',
    `Timestamp: ${timestamp}`,
    `Console: ${dashboardUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  const accentColor =
    severity === 'Critical' ? '#B91C1C' : severity === 'Warning' ? '#B45309' : '#047857';

  const html = `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0F172A; max-width: 600px; margin: 0 auto; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden;">
    <div style="background: #0F172A; color: #FFFFFF; padding: 16px 20px;">
      <div style="font-size: 12px; color: #94A3B8; letter-spacing: 0.04em;">XCLOUD.NET NOC ALERTING</div>
      <div style="font-size: 16px; font-weight: 700; margin-top: 4px;">${escapeHtml(tag + triggerLabel)} — ${escapeHtml(router.name)}</div>
    </div>
    <div style="padding: 20px; background: #FFFFFF;">
      <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: ${accentColor};">
        ${escapeHtml(summary)}
      </p>
      ${
        errorDetail
          ? `<div style="margin-bottom: 16px; padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; font-family: monospace; font-size: 12px; color: #991B1B;">${escapeHtml(errorDetail)}</div>`
          : ''
      }
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr><td style="padding: 6px 0; color: #64748B; width: 150px;">Tenant</td><td style="padding: 6px 0; font-weight: 600;">${escapeHtml(orgName)}</td></tr>
        <tr><td style="padding: 6px 0; color: #64748B;">Hotspot Site</td><td style="padding: 6px 0;">${escapeHtml(router.siteName)}</td></tr>
        <tr><td style="padding: 6px 0; color: #64748B;">Hardware</td><td style="padding: 6px 0;">${escapeHtml(router.vendor)} · ${escapeHtml(router.model)}</td></tr>
        <tr><td style="padding: 6px 0; color: #64748B;">WAN / API Host</td><td style="padding: 6px 0; font-family: monospace;">${escapeHtml(router.ipAddress)}:${router.apiPort}</td></tr>
        <tr><td style="padding: 6px 0; color: #64748B;">WireGuard Tunnel</td><td style="padding: 6px 0; font-family: monospace;">${escapeHtml(router.wireguardTunnelIp)}</td></tr>
        <tr><td style="padding: 6px 0; color: #64748B;">Router Status</td><td style="padding: 6px 0; font-weight: 600;">${escapeHtml(router.status)}</td></tr>
        <tr><td style="padding: 6px 0; color: #64748B;">CPU / Memory</td><td style="padding: 6px 0; font-family: monospace;">${router.cpuPercent}% CPU · ${router.memoryPercent}% RAM</td></tr>
        <tr><td style="padding: 6px 0; color: #64748B;">Active Leases</td><td style="padding: 6px 0; font-family: monospace;">${router.activeLeases}</td></tr>
        <tr><td style="padding: 6px 0; color: #64748B;">Detected At</td><td style="padding: 6px 0; font-family: monospace;">${escapeHtml(timestamp)}</td></tr>
      </table>
      <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid #E2E8F0;">
        <a href="${escapeHtml(dashboardUrl)}" style="display: inline-block; background: #1D4ED8; color: #FFFFFF; text-decoration: none; font-size: 13px; font-weight: 600; padding: 9px 14px; border-radius: 6px;">
          Open XCLOUD.NET Console
        </a>
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}

export async function dispatchRouterAlertEmail(params: {
  router: RouterDevice;
  triggerType: AlertTriggerType;
  severity: AlertSeverity;
  summary: string;
  errorDetail?: string | null;
  explicitRecipients?: string[];
  isTest?: boolean;
}): Promise<AlertEmailLog> {
  const { router, triggerType, severity, summary, errorDetail, explicitRecipients, isTest } = params;
  const setting = getRouterAlertSetting(router.organizationId);
  const orgName = getOrgNameSafe(router.organizationId);

  const rawRecipients =
    explicitRecipients && explicitRecipients.length > 0
      ? explicitRecipients
      : setting.recipientEmails.length > 0
      ? setting.recipientEmails
      : getDefaultAdminRecipients(router.organizationId);

  const recipients = Array.from(
    new Set(rawRecipients.map((e) => e.trim().toLowerCase()).filter((e) => isValidEmail(e)))
  );

  const { subject, text, html } = buildEmailContent({
    router,
    orgName,
    triggerType,
    severity,
    summary,
    errorDetail,
    isTest,
  });

  const transportStatus = getEmailTransportStatus();
  let deliveryStatus: AlertEmailLog['deliveryStatus'] = 'Skipped';
  let providerMessageId: string | undefined;
  let deliveryError: string | undefined;

  if (recipients.length === 0) {
    deliveryStatus = 'Skipped';
    deliveryError = 'No valid administrator email recipients configured for this tenant.';
  } else if (!transportStatus.configured) {
    deliveryStatus = 'Skipped';
    deliveryError = 'Email transport is not configured (set SMTP_HOST or RESEND_API_KEY in server environment secrets).';
  } else if (transportStatus.provider === 'Resend') {
    const resendKey = process.env.RESEND_API_KEY!.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: transportStatus.fromEmail,
          to: recipients,
          subject,
          text,
          html,
        }),
        signal: controller.signal,
      });
      const data = (await resp.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (resp.ok) {
        deliveryStatus = 'Sent';
        providerMessageId = data?.id;
      } else {
        deliveryStatus = 'Failed';
        deliveryError = data?.message || `Resend API returned HTTP ${resp.status}.`;
      }
    } catch (err) {
      deliveryStatus = 'Failed';
      deliveryError = err instanceof Error ? err.message : 'Resend email request failed.';
    } finally {
      clearTimeout(timer);
    }
  } else {
    const smtpHost = process.env.SMTP_HOST!.trim();
    const smtpPort = Number(process.env.SMTP_PORT) || 587;
    const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;
    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
        connectionTimeout: 8000,
        greetingTimeout: 8000,
      });
      const info = await transporter.sendMail({
        from: transportStatus.fromEmail,
        to: recipients.join(', '),
        subject,
        text,
        html,
      });
      deliveryStatus = 'Sent';
      providerMessageId = info.messageId;
    } catch (err) {
      deliveryStatus = 'Failed';
      deliveryError = err instanceof Error ? err.message : 'SMTP delivery failed.';
    }
  }

  const logEntry: AlertEmailLog = {
    id: `alrt-${crypto.randomBytes(4).toString('hex')}`,
    organizationId: router.organizationId,
    organizationName: orgName,
    routerId: router.id,
    routerName: router.name,
    vendor: router.vendor,
    siteName: router.siteName,
    triggerType,
    severity,
    recipients,
    subject,
    summary,
    deliveryStatus,
    provider: transportStatus.provider,
    providerMessageId,
    errorDetail: deliveryError || errorDetail || undefined,
    createdAt: new Date().toISOString(),
  };

  store.alertLogs.unshift(logEntry);
  if (store.alertLogs.length > 100) {
    store.alertLogs.length = 100;
  }

  const notifJob = store.workerJobs.find((j) => j.key === 'notifications');
  if (notifJob) {
    notifJob.lastRunAt = logEntry.createdAt;
    notifJob.processedCount += 1;
    notifJob.summary = `${router.name} ${triggerType.replace(/_/g, ' ')} -> ${deliveryStatus} (${recipients.length} recipient(s)).`;
  }

  store.addAudit(
    router.organizationId,
    'Router Alert Engine',
    'system',
    `Router Alert (${deliveryStatus})`,
    `${router.name} · ${triggerType} -> ${recipients.join(', ') || 'No recipients'}`
  );
  store.save();

  return logEntry;
}

export async function evaluateAndDispatchRouterAlerts(params: {
  router: RouterDevice;
  prevStatus: OnlineStatus;
  prevError?: string | null;
  errorDetail?: string | null;
}): Promise<AlertEmailLog | null> {
  const { router, prevStatus, prevError, errorDetail } = params;
  const setting = getRouterAlertSetting(router.organizationId);
  if (!setting.enabled) {
    return null;
  }

  const cooldownMs = Math.max(1, setting.cooldownMinutes) * 60_000;
  const now = Date.now();

  if (router.status === 'Offline') {
    if (!setting.notifyOnOffline) return null;
    const key = `${router.id}:router_offline`;
    const lastSent = lastAlertSentAt.get(key) || 0;
    const transitionedOffline = prevStatus !== 'Offline';
    if (!transitionedOffline && now - lastSent < cooldownMs) {
      return null;
    }

    lastAlertSentAt.set(key, now);
    activeIncidentRouters.add(router.id);
    return dispatchRouterAlertEmail({
      router,
      triggerType: 'router_offline',
      severity: 'Critical',
      summary: `${router.vendor} router ${router.name} at ${router.siteName} is OFFLINE and unreachable on ${router.ipAddress}:${router.apiPort}.`,
      errorDetail: errorDetail || router.lastError || 'TCP/API health probe timed out or connection refused.',
    });
  }

  const highCpu = router.cpuPercent >= setting.cpuCriticalThreshold;
  const highMem = router.memoryPercent >= setting.memoryCriticalThreshold;
  const hasCriticalError =
    router.status === 'Degraded' ||
    highCpu ||
    highMem ||
    Boolean(errorDetail);

  if (hasCriticalError) {
    if (!setting.notifyOnCriticalError) return null;
    const key = `${router.id}:router_critical_error`;
    const lastSent = lastAlertSentAt.get(key) || 0;
    const isNewCritical = prevStatus === 'Online' && !prevError;
    if (!isNewCritical && now - lastSent < cooldownMs) {
      return null;
    }

    const reasons: string[] = [];
    if (highCpu) reasons.push(`CPU critical at ${router.cpuPercent}% (threshold ${setting.cpuCriticalThreshold}%)`);
    if (highMem) reasons.push(`Memory critical at ${router.memoryPercent}% (threshold ${setting.memoryCriticalThreshold}%)`);
    if (errorDetail) reasons.push(errorDetail);
    else if (router.lastError) reasons.push(router.lastError);
    if (reasons.length === 0) reasons.push('Router telemetry reported Degraded hardware/API health state.');

    lastAlertSentAt.set(key, now);
    activeIncidentRouters.add(router.id);
    return dispatchRouterAlertEmail({
      router,
      triggerType: 'router_critical_error',
      severity: 'Critical',
      summary: `Critical error detected on ${router.vendor} router ${router.name} (${router.siteName}): ${reasons[0]}`,
      errorDetail: reasons.join(' | '),
    });
  }

  if (router.status === 'Online' && activeIncidentRouters.has(router.id)) {
    activeIncidentRouters.delete(router.id);
    lastAlertSentAt.delete(`${router.id}:router_offline`);
    lastAlertSentAt.delete(`${router.id}:router_critical_error`);
    if (setting.notifyOnRecovery) {
      return dispatchRouterAlertEmail({
        router,
        triggerType: 'router_recovered',
        severity: 'Resolved',
        summary: `${router.vendor} router ${router.name} (${router.siteName}) has RECOVERED and is back Online.`,
      });
    }
  }

  return null;
}
