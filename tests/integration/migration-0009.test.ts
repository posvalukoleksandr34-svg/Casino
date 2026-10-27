/**
 * Migration 0009 on a database that already holds accounts: it runs against
 * a scratch database migrated to 0008 with a pre-existing player (session,
 * wallet entries, a round), then applies 0009 and checks that nothing was
 * lost and that the account is grandfathered: e-mail recorded as verified by
 * LEGACY_MIGRATION (an assumption, not proof), no onboarding required, no
 * personal details invented. New rows default to the full journey.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@/server/db/migrator';

const base = new URL(process.env.DATABASE_URL_TEST ?? 'postgresql://casino:casino@localhost:5432/casino_test');
const NAME = 'casino_test_mig0009';
let admin: pg.Pool;
let pool: pg.Pool;
let partial: string;

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: base.toString() });
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const url = new URL(base.toString());
  url.pathname = `/${NAME}`;
  pool = new pg.Pool({ connectionString: url.toString() });
  partial = mkdtempSync(path.join(os.tmpdir(), 'mig0008-'));
  for (const f of readdirSync('migrations').filter((f) => f < '0009')) cpSync(path.join('migrations', f), path.join(partial, f));
  await migrate(pool, partial);
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin?.end();
  if (partial) rmSync(partial, { recursive: true, force: true });
});

describe('migration 0009 with existing accounts', () => {
  it('grandfathers existing accounts without losing or inventing anything', async () => {
    const { rows: [u] } = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO users (email, username, password_hash, display_name, created_at) VALUES ('legacy@example.test', 'legacy_player', 'scrypt$x', 'Legacy', now() - interval '400 days') RETURNING id, created_at`,
    );
    await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'h-legacy', now() + interval '1 day')`, [u!.id]);
    const before = await pool.query(`SELECT count(*)::int AS n FROM users`);

    const result = await migrate(pool);
    expect(result.applied).toContain('0009_registration_onboarding.sql');

    const { rows: [after] } = await pool.query(`SELECT * FROM users WHERE id = $1`, [u!.id]);
    expect(after.email).toBe('legacy@example.test');
    expect(after.display_name).toBe('Legacy');
    expect(after.password_hash).toBe('scrypt$x');
    expect(after.email_verified_at.getTime()).toBe(u!.created_at.getTime());
    expect(after.email_verification_method).toBe('LEGACY_MIGRATION');
    expect(after.onboarding_required).toBe(false);
    expect(after.onboarding_completed_at).toBeNull();
    for (const k of ['first_name', 'last_name', 'date_of_birth', 'country_code', 'phone_e164', 'phone_verified_at', 'terms_version']) expect(after[k], k).toBeNull();
    expect((await pool.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(before.rows[0].n);
    expect((await pool.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, [u!.id])).rows[0].n).toBe(1);

    // Accounts created after the migration go through verification and onboarding.
    const { rows: [fresh] } = await pool.query(`INSERT INTO users (email, username) VALUES ('new@example.test', 'new_player') RETURNING email_verified_at, onboarding_required`);
    expect(fresh.email_verified_at).toBeNull();
    expect(fresh.onboarding_required).toBe(true);
  });

  it('enforces the new constraints', async () => {
    const bad = (sql: string) => expect(pool.query(sql)).rejects.toThrow();
    await bad(`INSERT INTO users (email, username, country_code) VALUES ('c@example.test', 'c1', 'gb')`);
    await bad(`INSERT INTO users (email, username, phone_e164) VALUES ('p@example.test', 'p1', '07400123456')`);
    await bad(`INSERT INTO users (email, username, email_verified_at) VALUES ('v@example.test', 'v1', now())`);
    await bad(`INSERT INTO users (email, username, onboarding_completed_at) VALUES ('o@example.test', 'o1', now())`);
    await bad(`INSERT INTO users (email, username, phone_verified_at) VALUES ('q@example.test', 'q1', now())`);
    const { rows: [u] } = await pool.query(`INSERT INTO users (email, username) VALUES ('ch@example.test', 'ch1') RETURNING id`);
    const ch = `INSERT INTO email_verification_challenges (user_id, purpose, email, code_mac, expires_at) VALUES ('${u.id}', 'SIGNUP', 'ch@example.test', repeat('a', 64), now() + interval '10 minutes')`;
    await pool.query(ch);
    await bad(ch); // only one live challenge per account
    await bad(`INSERT INTO email_verification_challenges (user_id, purpose, email, code_mac, expires_at) VALUES ('${u.id}', 'SIGNUP', 'x@example.test', '123456', now() + interval '1 minute')`);
  });
});
