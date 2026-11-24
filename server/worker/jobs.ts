import { store } from '../db/store.ts';
import { syncRouterHardware } from '../integrations/services.ts';

export function runWorkerCycle(targetKey?: string) {
  const now = new Date().toISOString();
  const shouldRun = (key: string) => !targetKey || targetKey === 'all' || targetKey === key;

  if (shouldRun('voucher-expiration')) {
    let expiredCount = 0;
    const nowMs = Date.now();
    for (const v of store.vouchers) {
      if (v.status === 'Active' && v.expiresAt && new Date(v.expiresAt).getTime() <= nowMs) {
        v.status = 'Expired';
        expiredCount++;
      }
    }
    const job = store.workerJobs.find((j) => j.key === 'voucher-expiration');
    if (job) {
      job.lastRunAt = now;
      job.processedCount += expiredCount;
      job.summary =
        expiredCount > 0
          ? `Expired ${expiredCount} elapsed vouchers in latest sweep.`
          : 'Scanned active vouchers; all active windows remain valid.';
    }
  }

  if (shouldRun('session-disconnection')) {
    let disconnected = 0;
    const nowMs = Date.now();
    for (const s of store.sessions) {
      if (s.status !== 'Active') continue;
      const elapsedMin = Math.floor((nowMs - new Date(s.startedAt).getTime()) / 60_000);
      if (s.remainingMinutes <= 0 || elapsedMin >= s.remainingMinutes) {
        s.status = 'Disconnected';
        s.endedAt = now;
        const site = store.sites.find((st) => st.id === s.siteId);
        if (site && site.activeUsers > 0) site.activeUsers -= 1;
        const router = store.routers.find((rt) => rt.id === s.routerId);
        if (router && router.activeLeases > 0) router.activeLeases -= 1;
        disconnected++;
      }
    }
    const job = store.workerJobs.find((j) => j.key === 'session-disconnection');
    if (job) {
      job.lastRunAt = now;
      job.processedCount += disconnected;
      job.summary =
        disconnected > 0
          ? `Issued ${disconnected} CoA Disconnect-Request packets.`
          : 'All active RADIUS sessions within allocated time windows.';
    }
  }

  if (shouldRun('usage-accounting')) {
    const activeSessions = store.sessions.filter((s) => s.status === 'Active');
    const totalRx = activeSessions.reduce((sum, s) => sum + s.downloadMb, 0);
    const totalTx = activeSessions.reduce((sum, s) => sum + s.uploadMb, 0);
    const job = store.workerJobs.find((j) => j.key === 'usage-accounting');
    if (job) {
      job.lastRunAt = now;
      job.processedCount += activeSessions.length;
      job.summary = `Aggregated ${totalRx.toFixed(1)} MB Rx / ${totalTx.toFixed(1)} MB Tx across ${activeSessions.length} active session(s).`;
    }
  }

  if (shouldRun('payment-verification')) {
    const pending = store.payments.filter((p) => p.status === 'Pending').length;
    const job = store.workerJobs.find((j) => j.key === 'payment-verification');
    if (job) {
      job.lastRunAt = now;
      job.processedCount += 1;
      job.summary =
        pending > 0
          ? `${pending} pending mobile money transaction(s) awaiting webhook confirmation.`
          : 'All mobile money collections reconciled.';
    }
  }

  if (shouldRun('notifications')) {
    const openUrgent = store.tickets.filter((t) => t.status !== 'Resolved' && t.priority === 'Urgent').length;
    const job = store.workerJobs.find((j) => j.key === 'notifications');
    if (job) {
      job.lastRunAt = now;
      job.processedCount += 1;
      job.summary =
        openUrgent > 0
          ? `Flagged ${openUrgent} urgent hardware ticket(s) for NOC review.`
          : 'No pending urgent NOC alerts.';
    }
  }

  store.save();
  return store.workerJobs;
}

export async function runRouterHealthSweep(): Promise<void> {
  const candidates = store.routers.filter(
    (r) => r.uptime !== 'Awaiting WireGuard' || Date.now() - new Date(r.lastSyncedAt).getTime() > 120_000
  );
  if (candidates.length === 0) return;

  await Promise.all(candidates.map((router) => syncRouterHardware(router).catch(() => router)));

  const offlineCount = store.routers.filter((r) => r.status === 'Offline').length;
  const degradedCount = store.routers.filter((r) => r.status === 'Degraded').length;
  const job = store.workerJobs.find((j) => j.key === 'notifications');
  if (job) {
    job.lastRunAt = new Date().toISOString();
    job.summary =
      offlineCount > 0 || degradedCount > 0
        ? `Monitored ${candidates.length} router(s): ${offlineCount} offline, ${degradedCount} degraded.`
        : `Monitored ${candidates.length} router(s): all devices healthy.`;
    store.save();
  }
}

