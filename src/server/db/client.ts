import { randomInt } from 'node:crypto';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import * as schema from './schema';

/*
 * BIGINT columns hold minor-unit amounts. Parse them into JS numbers but fail
 * loudly rather than silently losing precision beyond 2^53.
 */
pg.types.setTypeParser(20, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`bigint value ${value} exceeds the safe integer range`);
  return n;
});

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run queries: the pool-backed db or an open transaction. */
export type Executor = Db | Tx;

interface DbHolder {
  pool: pg.Pool;
  db: Db;
}

const globalForDb = globalThis as unknown as { __casinoDb?: DbHolder };

function create(): DbHolder {
  const pool = new pg.Pool({
    connectionString: env().DATABASE_URL,
    max: env().DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'aurovane',
  });
  pool.on('error', (err) => {
    // Idle client errors (e.g. server restart) must not crash the process.
    console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: err.message }));
  });
  return { pool, db: drizzle(pool, { schema }) };
}

function holder(): DbHolder {
  if (!globalForDb.__casinoDb) globalForDb.__casinoDb = create();
  return globalForDb.__casinoDb;
}

export function getDb(): Db {
  return holder().db;
}

export function getPool(): pg.Pool {
  return holder().pool;
}

export async function closeDb(): Promise<void> {
  const h = globalForDb.__casinoDb;
  globalForDb.__casinoDb = undefined;
  if (h) await h.pool.end();
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

/**
 * Runs `fn` in a READ COMMITTED transaction (row locks provide the required
 * isolation; see docs/architecture.md#concurrency). Serialization failures
 * and deadlocks are retried with jittered backoff; the whole callback is
 * re-executed, so it must not have side effects outside the transaction.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>, opts: { retries?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getDb().transaction(fn);
    } catch (err) {
      const code = pgErrorCode(err);
      if (code && RETRYABLE.has(code) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 10 * 2 ** attempt + randomInt(10)));
        continue;
      }
      throw err;
    }
  }
}

/** Extracts the SQLSTATE from a pg error, including errors wrapped by Drizzle. */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const c = (current as { constraint?: unknown }).constraint;
    if (typeof c === 'string') return c;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
