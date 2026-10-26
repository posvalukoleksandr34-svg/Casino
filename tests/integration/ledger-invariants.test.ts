import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, withTransaction } from '@/server/db/client';
import { getWalletAccount, systemAccountIds } from '@/server/ledger/accounts';
import { LedgerError, postTransaction } from '@/server/ledger/ledger';
import { AppError } from '@/server/errors';
import { expectDbError, expectLedgerConsistent, newPlayer } from './helpers';

describe('ledger invariants enforced by the database', () => {
  it('rejects unbalanced postings in application code', async () => {
    const ids = await systemAccountIds(getDb());
    await expect(
      withTransaction((tx) =>
        postTransaction(tx, {
          type: 'ADJUSTMENT',
          idempotencyKey: 'test:unbalanced',
          description: 'x',
          postings: [
            { accountId: ids.ADJUSTMENTS, amount: -100 },
            { accountId: ids.PROMOTIONS, amount: 99 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(LedgerError);
  });

  it('rejects an unbalanced transaction at COMMIT even if application checks are bypassed', async () => {
    const ids = await systemAccountIds(getDb());
    await expectDbError(
      withTransaction(async (tx) => {
        const res = await tx.execute<{ id: number }>(
          sql`INSERT INTO ledger_transactions (type, idempotency_key, description) VALUES ('ADJUSTMENT', 'test:raw-unbalanced', 'raw') RETURNING id`,
        );
        await tx.execute(sql`INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (${res.rows[0]!.id}, ${ids.ADJUSTMENTS}, 500)`);
      }),
      /unbalanced/,
    );
    const check = await getDb().execute(sql`SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'test:raw-unbalanced'`);
    expect(check.rows).toHaveLength(0);
  });

  it('ledger rows are append-only', async () => {
    const db = getDb();
    await expectDbError(db.execute(sql`UPDATE ledger_entries SET amount = amount + 1 WHERE id = (SELECT min(id) FROM ledger_entries)`), /append-only/);
    await expectDbError(db.execute(sql`DELETE FROM ledger_entries WHERE id = (SELECT min(id) FROM ledger_entries)`), /append-only/);
    await expectDbError(db.execute(sql`UPDATE ledger_transactions SET description = 'tampered'`), /append-only/);
    await expectDbError(db.execute(sql`TRUNCATE ledger_entries`), /append-only|cannot truncate/);
    await expectDbError(db.execute(sql`DELETE FROM audit_logs`), /append-only/);
    await expectDbError(db.execute(sql`DELETE FROM payouts`), /append-only/);
    await expectDbError(db.execute(sql`UPDATE bets SET stake = 1`), /append-only/);
  });

  it('balances cannot be edited directly, only through ledger entries', async () => {
    const p = await newPlayer();
    const wallet = await getWalletAccount(getDb(), p.userId);
    await expectDbError(
      getDb().execute(sql`UPDATE ledger_accounts SET balance = balance + 1000000 WHERE id = ${wallet!.id}`),
      /only change through ledger entries/,
    );
  });

  it('a player wallet can never go negative', async () => {
    const p = await newPlayer();
    const wallet = await getWalletAccount(getDb(), p.userId);
    const ids = await systemAccountIds(getDb());
    await expect(
      withTransaction((tx) =>
        postTransaction(tx, {
          type: 'ADJUSTMENT',
          idempotencyKey: `test:overdraw:${p.userId}`,
          description: 'overdraw',
          postings: [
            { accountId: wallet!.id, amount: -(wallet!.balance + 1) },
            { accountId: ids.ADJUSTMENTS, amount: wallet!.balance + 1 },
          ],
        }),
      ),
    ).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'INSUFFICIENT_FUNDS');
    expect((await getWalletAccount(getDb(), p.userId))!.balance).toBe(wallet!.balance);
  });

  it('a business key can only be posted once', async () => {
    const ids = await systemAccountIds(getDb());
    const post = () =>
      withTransaction((tx) =>
        postTransaction(tx, {
          type: 'ADJUSTMENT',
          idempotencyKey: 'test:once',
          description: 'once',
          postings: [
            { accountId: ids.ADJUSTMENTS, amount: -1 },
            { accountId: ids.PROMOTIONS, amount: 1 },
          ],
        }),
      );
    await post();
    await expect(post()).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'CONFLICT');
  });

  it('signup bonus is credited through the ledger and everything reconciles', async () => {
    const p = await newPlayer();
    const wallet = await getWalletAccount(getDb(), p.userId);
    expect(wallet!.balance).toBe(1_000_000);
    await expectLedgerConsistent();
  });
});
