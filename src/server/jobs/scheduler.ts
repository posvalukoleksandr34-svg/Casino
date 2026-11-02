/**
 * In-process job scheduler. Each job takes a PostgreSQL advisory lock so that
 * with several app instances only one runs a given job at a time. Every tick is
 * counted (casino_job_runs_total{job,outcome}) and successes set
 * casino_job_last_success_timestamp_seconds{job}, so monitoring can alert on a
 * job that fails or stops running (deploy/monitoring/alerts.yml).
 */
import { getPool } from '../db/client';
import { env } from '../env';
import { logger } from '../observability/logger';
import { captureError } from '../observability/errors';
import { metrics } from '../observability/metrics';
import { expireDueRounds } from '../games/round-service';
import { runReconciliation } from './reconciliation';
import { cleanupExpired, detectAnomalies } from './anomaly';
import { syncSports } from '../sports/sync';
import { ensureCommitments } from '../games/roulette-table';
import { expireDueBonuses } from '../promotions/campaigns';
import { expireDeposits } from '../payments/deposits';
import { settleSandboxPayouts } from '../payments/sandbox-actions';
import { sendNotificationEmails } from '../notifications/notifications';

interface Job {
  name: string;
  lockId: number;
  intervalMs: number;
  run: () => Promise<unknown>;
  /** Also run once right after start-up, not only after the first interval. */
  atStart?: boolean;
}

export async function withAdvisoryLock(lockId: number, fn: () => Promise<unknown>): Promise<boolean> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [lockId]);
    if (!rows[0]?.ok) return false;
    try {
      await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
    }
    return true;
  } finally {
    client.release();
  }
}

const g = globalThis as unknown as { __casinoScheduler?: NodeJS.Timeout[] };

export function startScheduler(): void {
  if (g.__casinoScheduler) return;
  const jobs: Job[] = [
    { name: 'expire-rounds', lockId: 7_342_101, intervalMs: 5_000, run: () => expireDueRounds() },
    { name: 'reconciliation', lockId: 7_342_102, intervalMs: env().RECONCILE_INTERVAL_MINUTES * 60_000, run: () => runReconciliation('scheduler') },
    { name: 'anomaly-detection', lockId: 7_342_103, intervalMs: 5 * 60_000, run: () => detectAnomalies() },
    { name: 'cleanup', lockId: 7_342_104, intervalMs: 60 * 60_000, run: () => cleanupExpired() },
    { name: 'sports-sync', lockId: 7_342_105, intervalMs: 60_000, run: () => syncSports() },
    // Roulette table: commit today's and tomorrow's seeds ahead of time, so every table spin's
    // commitment exists before its betting closes even when nobody has opened the table yet.
    // Bonuses past their deadline return their locked credits to promotions.
    { name: 'bonus-expiry', lockId: 7_342_107, intervalMs: 5 * 60_000, run: () => expireDueBonuses() },
    // Cashier: unpaid deposits expire; sandbox payouts settle after a minute (sandbox mode only);
    // notification e-mails are sent after the transaction that created them has committed.
    { name: 'deposit-expiry', lockId: 7_342_108, intervalMs: 60_000, run: () => expireDeposits() },
    { name: 'sandbox-payouts', lockId: 7_342_109, intervalMs: 30_000, run: () => settleSandboxPayouts() },
    { name: 'notification-mail', lockId: 7_342_110, intervalMs: 30_000, run: () => sendNotificationEmails() },
    { name: 'roulette-commitments', lockId: 7_342_106, intervalMs: 60 * 60_000, run: () => ensureCommitments(), atStart: true },
  ];
  g.__casinoScheduler = jobs.map((job) => {
    const tick = async () => {
      try {
        const ran = await withAdvisoryLock(job.lockId, job.run);
        metrics.inc('casino_job_runs_total', { job: job.name, outcome: ran ? 'ok' : 'skipped_locked' });
        if (ran) metrics.set('casino_job_last_success_timestamp_seconds', { job: job.name }, Math.floor(Date.now() / 1000));
      } catch (err) {
        metrics.inc('casino_job_runs_total', { job: job.name, outcome: 'failed' });
        captureError(err, { route: `job:${job.name}` });
      }
    };
    const timer = setInterval(tick, job.intervalMs);
    timer.unref();
    if (job.atStart) setTimeout(tick, 2_000).unref();
    return timer;
  });
  logger.info('background scheduler started', { jobs: jobs.map((j) => j.name) });
}
