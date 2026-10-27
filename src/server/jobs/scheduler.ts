/**
 * In-process job scheduler. Each job takes a PostgreSQL advisory lock so that
 * with several app instances only one runs a given job at a time.
 */
import { getPool } from '../db/client';
import { env } from '../env';
import { logger } from '../observability/logger';
import { captureError } from '../observability/errors';
import { expireDueRounds } from '../games/round-service';
import { runReconciliation } from './reconciliation';
import { cleanupExpired, detectAnomalies } from './anomaly';
import { syncSports } from '../sports/sync';

interface Job {
  name: string;
  lockId: number;
  intervalMs: number;
  run: () => Promise<unknown>;
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
  ];
  g.__casinoScheduler = jobs.map((job) => {
    const tick = async () => {
      try {
        await withAdvisoryLock(job.lockId, job.run);
      } catch (err) {
        captureError(err, { route: `job:${job.name}` });
      }
    };
    const timer = setInterval(tick, job.intervalMs);
    timer.unref();
    return timer;
  });
  logger.info('background scheduler started', { jobs: jobs.map((j) => j.name) });
}
