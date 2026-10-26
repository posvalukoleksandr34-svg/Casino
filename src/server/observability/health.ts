import { sql } from 'drizzle-orm';
import { getDb, getPool } from '../db/client';
import { pendingMigrations } from '../db/migrator';
import { latestReconciliation } from '../jobs/reconciliation';
import { env } from '../env';
import { passwordRecoveryMode } from '../users/accounts';

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
  ms?: number;
}

async function timed(name: string, fn: () => Promise<string | undefined>): Promise<HealthCheck> {
  const t = performance.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail, ms: Math.round(performance.now() - t) };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message, ms: Math.round(performance.now() - t) };
  }
}

/**
 * The runtime role must not be a superuser and must not be able to act as the
 * owner of the ledger tables (owners can disable the append-only triggers).
 * Enforced in production; reported elsewhere.
 */
async function databaseRole(): Promise<string> {
  const { rows } = await getPool().query<{ superuser: boolean; owner: boolean }>(`
    SELECT r.rolsuper AS superuser,
           pg_has_role(current_user, c.relowner, 'MEMBER') AS owner
      FROM pg_roles r, pg_class c
     WHERE r.rolname = current_user AND c.oid = 'public.ledger_entries'::regclass`);
  const privileged = rows[0]?.superuser === true || rows[0]?.owner === true;
  if (!privileged) return 'least privilege';
  if (env().NODE_ENV === 'production' && !env().ALLOW_PRIVILEGED_DB_ROLE) {
    throw new Error('the application database role is a superuser or can act as the schema owner');
  }
  return 'privileged (accepted outside production)';
}

export async function readiness() {
  const checks = await Promise.all([
    timed('database_role', databaseRole),
    timed('database', async () => {
      await getDb().execute(sql`SELECT 1`);
      return undefined;
    }),
    timed('migrations', async () => {
      const pending = await pendingMigrations(getPool());
      if (pending.length) throw new Error(`pending: ${pending.join(', ')}`);
      return 'up to date';
    }),
    timed('reference_data', async () => {
      const res = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM platform_settings`);
      if (!res.rows[0]?.n) throw new Error('platform settings missing (run db:migrate)');
      return undefined;
    }),
  ]);
  return { status: checks.every((c) => c.ok) ? 'ok' : 'degraded', checks, checkedAt: new Date().toISOString() };
}

/** Extended operational health for the admin dashboard. */
export async function operationalHealth() {
  const ready = await readiness();
  const pool = getPool();
  const recon = await latestReconciliation().catch(() => null);
  const errors = await getDb().execute<{ last_hour: number; last_day: number }>(sql`
    SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour,
           count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_day
    FROM error_events`);
  return {
    ...ready,
    pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      node: process.version,
    },
    reconciliation: recon,
    passwordRecovery: passwordRecoveryMode(),
    errors: errors.rows[0] ?? { last_hour: 0, last_day: 0 },
  };
}
