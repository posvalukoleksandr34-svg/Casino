/**
 * Least-privilege runtime role (migration 0004) and the balance guard.
 *
 * Production connects as `casino_app`, which owns nothing. These tests prove
 * (a) it cannot tamper with history, balances or triggers, even with the
 * session flag and temporary objects, and (b) every real application flow
 * works through it — so the role is not a paper exercise.
 */
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getPool, withTransaction } from '@/server/db/client';
import { resetEnvCache } from '@/server/env';
import { errorText, key, newPlayer } from './helpers';

async function asRole<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE casino_app');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

/** Runs one statement as casino_app inside a savepoint and returns the error text (or null). */
async function attempt(c: PoolClient, statement: string): Promise<string | null> {
  await c.query('SAVEPOINT a');
  try {
    await c.query(statement);
    await c.query('RELEASE SAVEPOINT a');
    return null;
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT a');
    return errorText(err);
  }
}

describe('balance guard', () => {
  it('the session flag alone no longer allows editing a balance (previously it did)', async () => {
    await newPlayer('guard');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL casino.ledger_posting = 'on'");
      const err = await client
        .query(`UPDATE ledger_accounts SET balance = balance + 1000000 WHERE id = (SELECT min(id) FROM ledger_accounts WHERE type = 'PLAYER_WALLET')`)
        .then(() => null)
        .catch((e: unknown) => errorText(e));
      expect(err).toMatch(/only change through ledger entries/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('casino_app cannot tamper', () => {
  it('has no ownership-level powers and no update/delete on append-only history', async () => {
    await asRole(async (c) => {
      expect(await attempt(c, 'UPDATE ledger_entries SET amount = amount + 1')).toMatch(/permission denied/);
      expect(await attempt(c, 'DELETE FROM audit_logs')).toMatch(/permission denied/);
      expect(await attempt(c, 'UPDATE payouts SET amount = 0')).toMatch(/permission denied/);
      expect(await attempt(c, 'DELETE FROM game_rounds')).toMatch(/permission denied/);
      expect(await attempt(c, 'TRUNCATE ledger_entries')).toMatch(/permission denied/);
      expect(await attempt(c, 'ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_append_only')).toMatch(/must be owner/);
      expect(await attempt(c, 'CREATE TABLE public.evil (id int)')).toMatch(/permission denied/);
      expect(await attempt(c, 'INSERT INTO schema_migrations (version, checksum) VALUES ($$x$$, $$y$$)')).toMatch(/permission denied/);
    });
  });

  it('cannot change a balance directly, even with the session flag', async () => {
    await asRole(async (c) => {
      await c.query("SET LOCAL casino.ledger_posting = 'on'");
      expect(await attempt(c, `UPDATE ledger_accounts SET balance = balance + 1 WHERE type = 'PLAYER_WALLET'`)).toMatch(/only change through ledger entries/);
      expect(await attempt(c, `UPDATE ledger_accounts SET allow_negative = true WHERE type = 'PLAYER_WALLET'`)).toMatch(/identity is immutable/);
    });
  });

  it('cannot change a balance from inside its own (temporary) trigger either', async () => {
    await asRole(async (c) => {
      const created = await attempt(
        c,
        `CREATE TEMP TABLE t_evil (x int);
         CREATE FUNCTION pg_temp.evil() RETURNS trigger LANGUAGE plpgsql AS $f$
         BEGIN
           PERFORM set_config('casino.ledger_posting', 'on', true);
           UPDATE ledger_accounts SET balance = balance + 1 WHERE type = 'PLAYER_WALLET';
           RETURN NEW;
         END $f$;
         CREATE TRIGGER t_evil BEFORE INSERT ON t_evil FOR EACH ROW EXECUTE FUNCTION pg_temp.evil();`,
      );
      if (created === null) {
        // Trigger depth is now 2, but the statement still runs as casino_app, not the owner.
        expect(await attempt(c, 'INSERT INTO t_evil VALUES (1)')).toMatch(/only change through ledger entries/);
      } else {
        expect(created).toMatch(/permission denied/); // TEMP revoked: even better
      }
    });
  });
});

describe('every application flow works as casino_app', () => {
  const ownerUrl = process.env.DATABASE_URL!;
  beforeAll(async () => {
    await closeDb();
    const url = new URL(ownerUrl);
    url.searchParams.set('options', '-c role=casino_app');
    process.env.DATABASE_URL = url.toString();
    resetEnvCache();
  });
  afterAll(async () => {
    await closeDb();
    process.env.DATABASE_URL = ownerUrl;
    resetEnvCache();
  });

  it('runs as casino_app, and readiness reports least privilege', async () => {
    const { rows } = await getPool().query<{ u: string }>('SELECT current_user AS u');
    expect(rows[0]!.u).toBe('casino_app');
    const { readiness } = await import('@/server/observability/health');
    const report = await readiness();
    expect(report.checks.find((c) => c.name === 'database_role')).toMatchObject({ ok: true, detail: 'least privilege' });
    expect(report.status).toBe('ok');
  });

  it('registration, wagers, interactive play, expiry, void, adjustment, seeds, jobs and reconciliation', async () => {
    const { startRound, actOnRound, voidRound, expireDueRounds } = await import('@/server/games/round-service');
    const { adjustBalance } = await import('@/server/admin/admin-service');
    const { rotateSeed } = await import('@/server/fairness/seeds');
    const { runReconciliation } = await import('@/server/jobs/reconciliation');
    const { cleanupExpired, detectAnomalies } = await import('@/server/jobs/anomaly');
    const { consume, RATE_LIMITS } = await import('@/server/http/rate-limit');
    const { getDb } = await import('@/server/db/client');
    const { gameRounds, users } = await import('@/server/db/schema');
    const { eq } = await import('drizzle-orm');

    const p = await newPlayer('lp');
    const adm = await newPlayer('lpadm');
    await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, adm.userId));

    const k = key();
    await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: k });
    const replay = await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: k });
    expect(replay.replayed).toBe(true);
    const mines = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 100, mines: 1 }, idempotencyKey: key() });
    await actOnRound({ userId: p.userId, roundId: mines.body.round.id, action: { type: 'reveal', tile: 0 }, idempotencyKey: key() });
    const crash = await startRound({ userId: p.userId, gameId: 'crash', bet: { amount: 100, autoCashoutE2: 110 }, idempotencyKey: key() });
    await expireDueRounds(new Date(Date.now() + 120_000));
    const bj = await startRound({ userId: adm.userId, gameId: 'blackjack', bet: { amount: 100 }, idempotencyKey: key() });
    if (bj.body.round.status === 'OPEN') await voidRound({ roundId: bj.body.round.id, adminId: adm.userId, reason: 'Privilege test void' });
    await adjustBalance({ adminId: adm.userId, ipHash: null, requestId: key() }, p.userId, 500, 'Privilege test adjustment', key());
    const [openMines] = await getDb().select({ status: gameRounds.status }).from(gameRounds).where(eq(gameRounds.id, mines.body.round.id));
    if (openMines?.status === 'OPEN') {
      await actOnRound({ userId: p.userId, roundId: mines.body.round.id, action: { type: 'cashout' }, idempotencyKey: key() });
    }
    const rotated = await withTransaction((tx) => rotateSeed(tx, adm.userId));
    expect(rotated.revealed?.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    await consume(RATE_LIMITS.loginIp, `privilege-test-${key()}`);
    await detectAnomalies();
    await cleanupExpired();
    expect(crash.body.round.id).toBeDefined();
    const recon = await runReconciliation('privilege-test');
    expect(recon.status).toBe('OK');
  });
});

describe('readiness rejects a privileged runtime role in production', () => {
  it('the schema owner connection is not ready under NODE_ENV=production', async () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, {
        NODE_ENV: 'production',
        APP_URL: 'http://127.0.0.1:3999',
        SEED_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
        IP_HASH_SECRET: 'i'.repeat(40),
      });
      resetEnvCache();
      const { readiness } = await import('@/server/observability/health');
      const report = await readiness();
      expect(report.status).toBe('degraded');
      expect(report.checks.find((c) => c.name === 'database_role')).toMatchObject({ ok: false });
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      resetEnvCache();
    }
  });
});
