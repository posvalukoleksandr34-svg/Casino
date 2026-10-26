import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { getPool } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import { runChecksWith } from '@/server/jobs/reconciliation';
import { key, newPlayer } from './helpers';
import { startRound } from '@/server/games/round-service';

describe('schema drift', () => {
  it('every Drizzle table and column exists in the migrated database with matching nullability', async () => {
    const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => typeof v === 'object' && v !== null && Symbol.for('drizzle:IsDrizzleTable') in v);
    expect(tables.length).toBeGreaterThan(15);
    const { rows } = await getPool().query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const db = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.is_nullable === 'YES']));
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const dbColumns = rows.filter((r) => r.table_name === cfg.name).map((r) => r.column_name).sort();
      expect(cfg.columns.map((c) => c.name).sort(), `columns of ${cfg.name}`).toEqual(dbColumns);
      for (const c of cfg.columns) {
        expect(db.get(`${cfg.name}.${c.name}`), `${cfg.name}.${c.name} nullability`).toBe(!c.notNull);
      }
    }
  });
});

describe('reconciliation detects tampering', () => {
  it('flags a ledger entry edited behind the triggers (rolled back afterwards)', async () => {
    const p = await newPlayer('tamper');
    await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const clean = await runChecksWith(client);
      expect(clean.filter((c) => c.mismatches > 0)).toEqual([]);
      // A privileged attacker disables the append-only trigger and inflates an entry.
      await client.query('ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_append_only');
      await client.query(`UPDATE ledger_entries SET amount = amount + 500 WHERE id = (SELECT max(id) FROM ledger_entries)`);
      const dirty = await runChecksWith(client);
      const failing = dirty.filter((c) => c.mismatches > 0).map((c) => c.name);
      expect(failing).toEqual(expect.arrayContaining(['transactions_balanced', 'account_balances_match_entries', 'balance_after_chain']));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
