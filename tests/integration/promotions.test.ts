import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, withTransaction } from '@/server/db/client';
import { bonusCampaigns, bonusClaims, ledgerAccounts } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount, SYSTEM_ACCOUNTS } from '@/server/ledger/accounts';
import { startRound, actOnRound } from '@/server/games/round-service';
import { bonusOverview, claimBonus, expireDueBonuses, forfeitBonus } from '@/server/promotions/campaigns';
import { walletSummary } from '@/server/wallet/wallet';
import { startCoolOff } from '@/server/responsible/limits';
import { expectDbError, expectLedgerConsistent, key, newPlayer } from './helpers';

const db = () => getDb();
const balance = async (userId: string) => (await getWalletAccount(db(), userId))!.balance;
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));
const lockedAccount = async () => {
  const [a] = await db().select({ balance: ledgerAccounts.balance }).from(ledgerAccounts).where(eq(ledgerAccounts.code, SYSTEM_ACCOUNTS.BONUS_LOCKED.code));
  return a!.balance;
};
const welcomeId = async () => (await db().select({ id: bonusCampaigns.id }).from(bonusCampaigns).where(eq(bonusCampaigns.slug, 'welcome')))[0]!.id;

let codeSeq = 0;
async function promo(patch: Partial<typeof bonusCampaigns.$inferInsert> = {}) {
  codeSeq += 1;
  const suffix = `${Date.now().toString(36)}${codeSeq}`.toUpperCase();
  const [c] = await db()
    .insert(bonusCampaigns)
    .values({
      slug: `promo-${suffix.toLowerCase()}`,
      kind: 'PROMO_CODE',
      code: `T${suffix}`.slice(0, 20),
      name: 'Test promo',
      description: 'A promo for tests',
      fixedAmount: 50_000,
      maxBonus: 50_000,
      wageringMultiplier: 2,
      expiresAfterDays: 7,
      ...patch,
    })
    .returning();
  return c!;
}

/** Plays dice rounds of `amount` until `total` has been staked (each settles at once). */
async function wager(userId: string, total: number, amount = 10_000) {
  for (let staked = 0; staked < total; staked += amount) {
    await startRound({ userId, gameId: 'dice', bet: { amount: Math.min(amount, total - staked), target: 5000, direction: 'under' }, idempotencyKey: key() });
  }
}

describe('promotions: welcome offer', () => {
  it('the welcome offer matches 100% of the starting credits, locks them, and releases them after wagering once', async () => {
    const p = await newPlayer('welcome');
    const start = await balance(p.userId);
    const lockedBefore = await lockedAccount();
    const overview = await bonusOverview(p.userId);
    const offer = overview.offers.find((o) => o.name === 'Welcome bonus')!;
    expect(offer.eligible).toBe(true);
    expect(offer.amount).toBe(Math.min(start, 2_000_000));

    const res = await claimBonus(p.userId, { campaignId: offer.id });
    expect(res.amount).toBe(offer.amount);
    expect(res.wageringRequired).toBe(offer.amount);
    // Locked credits are not spendable: the wallet is unchanged.
    expect(await balance(p.userId)).toBe(start);
    expect(await lockedAccount()).toBe(lockedBefore + offer.amount);
    const summary = await walletSummary(p.userId);
    expect(summary.lockedBonus).toBe(offer.amount);
    expect(summary.available).toBe(start);
    await expectLedgerConsistent();

    // Wager in steps; progress counts settled stakes.
    await wager(p.userId, offer.amount / 2);
    const mid = (await bonusOverview(p.userId)).active!;
    expect(mid.wageringProgress).toBe(offer.amount / 2);
    const beforeRelease = await balance(p.userId);
    await wager(p.userId, offer.amount / 2);
    const after = await bonusOverview(p.userId);
    expect(after.active).toBeNull();
    expect(after.claims[0]!.status).toBe('COMPLETED');
    expect(after.claims[0]!.wageringProgress).toBe(offer.amount);
    // The released bonus reached the wallet (plus or minus the dice results).
    const s = await walletSummary(p.userId);
    expect(s.lockedBonus).toBe(0);
    expect(await lockedAccount()).toBe(lockedBefore);
    expect(await balance(p.userId)).toBeGreaterThanOrEqual(beforeRelease - offer.amount / 2 + offer.amount - 1);
    await expectLedgerConsistent();
  });

  it('is claimable once only, even with concurrent claims', async () => {
    const p = await newPlayer('welcome2');
    const id = await welcomeId();
    const results = await Promise.allSettled([claimBonus(p.userId, { campaignId: id }), claimBonus(p.userId, { campaignId: id }), claimBonus(p.userId, { campaignId: id })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(code(r.reason)).toBe('CONFLICT');
    await expect(claimBonus(p.userId, { campaignId: id })).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    const rows = await db().select().from(bonusClaims).where(and(eq(bonusClaims.userId, p.userId), eq(bonusClaims.campaignId, id)));
    expect(rows).toHaveLength(1);
    await expectLedgerConsistent();
  });

  it('is not offered to old accounts, during a cool-off, or by its id as if it were a code', async () => {
    const old = await newPlayer('welcome-old');
    await db().execute(sql`UPDATE users SET created_at = now() - interval '45 days' WHERE id = ${old.userId}`);
    const offer = (await bonusOverview(old.userId)).offers.find((o) => o.name === 'Welcome bonus')!;
    expect(offer.eligible).toBe(false);
    expect(offer.reason).toMatch(/30 days/);
    await expect(claimBonus(old.userId, { campaignId: offer.id })).rejects.toSatisfy((e) => code(e) === 'CONFLICT');

    const resting = await newPlayer('welcome-rest');
    await withTransaction((tx) => startCoolOff(tx, resting.userId, 24));
    await expect(claimBonus(resting.userId, { campaignId: await welcomeId() })).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    await expect(claimBonus(resting.userId, { code: 'WELCOME' })).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
  });
});

describe('promotions: promo codes', () => {
  it('a code is case-insensitive, once per player, capped in total, and blocked while another bonus is active', async () => {
    const c = await promo({ maxClaims: 2 });
    const [a, b, d] = [await newPlayer('promo-a'), await newPlayer('promo-b'), await newPlayer('promo-c')];
    await claimBonus(a.userId, { code: c.code!.toLowerCase() });
    await expect(claimBonus(a.userId, { code: c.code! })).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    await claimBonus(b.userId, { code: c.code! });
    await expect(claimBonus(d.userId, { code: c.code! })).rejects.toSatisfy((e) => /fully claimed/.test((e as Error).message));
    // a has an active bonus: a second code must wait.
    const other = await promo();
    await expect(claimBonus(a.userId, { code: other.code! })).rejects.toSatisfy((e) => /current bonus/.test((e as Error).message));
    await expect(claimBonus(a.userId, { code: 'NOSUCHCODE' })).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    await expectLedgerConsistent();
  });

  it('a code with no wagering requirement is released at once; ended and inactive codes are refused', async () => {
    const free = await promo({ wageringMultiplier: 0, fixedAmount: 12_345, maxBonus: 12_345 });
    const p = await newPlayer('promo-free');
    const before = await balance(p.userId);
    const res = await claimBonus(p.userId, { code: free.code! });
    expect(res.released).toBe(true);
    expect(await balance(p.userId)).toBe(before + 12_345);
    expect((await bonusOverview(p.userId)).claims[0]!.status).toBe('COMPLETED');

    const ended = await promo({ startsAt: new Date(Date.now() - 2 * 86_400_000), endsAt: new Date(Date.now() - 86_400_000) });
    const inactive = await promo({ active: false });
    const q = await newPlayer('promo-ended');
    await expect(claimBonus(q.userId, { code: ended.code! })).rejects.toSatisfy((e) => /ended/.test((e as Error).message));
    await expect(claimBonus(q.userId, { code: inactive.code! })).rejects.toSatisfy((e) => /no longer available/.test((e as Error).message));
    await expectLedgerConsistent();
  });
});

describe('promotions: forfeit, expiry and integrity', () => {
  it('forfeiting returns the locked credits to promotions and leaves the wallet unchanged', async () => {
    const c = await promo();
    const p = await newPlayer('forfeit');
    const res = await claimBonus(p.userId, { code: c.code! });
    const before = await balance(p.userId);
    await expect(forfeitBonus(p.userId, res.claimId + 999_999)).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    await forfeitBonus(p.userId, res.claimId);
    expect(await balance(p.userId)).toBe(before);
    expect((await bonusOverview(p.userId)).claims[0]!.status).toBe('FORFEITED');
    await expect(forfeitBonus(p.userId, res.claimId)).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    await expectLedgerConsistent();
  });

  it('expired bonuses stop counting wagers and are closed by the expiry job', async () => {
    const c = await promo({ expiresAfterDays: 1, startsAt: new Date(Date.now() - 3 * 86_400_000) });
    const p = await newPlayer('expiry');
    const res = await claimBonus(p.userId, { code: c.code! }, new Date(Date.now() - 2 * 86_400_000));
    // Past its deadline: wagering does not count.
    await wager(p.userId, 20_000);
    const claim = (await bonusOverview(p.userId)).active!;
    expect(claim.id).toBe(res.claimId);
    expect(claim.wageringProgress).toBe(0);
    const before = await balance(p.userId);
    expect(await expireDueBonuses()).toBeGreaterThanOrEqual(1);
    expect((await bonusOverview(p.userId)).claims[0]!.status).toBe('EXPIRED');
    expect(await balance(p.userId)).toBe(before);
    await expectLedgerConsistent();
  });

  it('an interactive round counts its whole stake once, when it settles', async () => {
    const c = await promo({ fixedAmount: 1_000_000, maxBonus: 1_000_000, wageringMultiplier: 1 });
    const p = await newPlayer('interactive');
    await claimBonus(p.userId, { code: c.code! });
    const res = await startRound({ userId: p.userId, gameId: 'mines', bet: { amount: 5_000, mines: 3 }, idempotencyKey: key() });
    expect((await bonusOverview(p.userId)).active!.wageringProgress).toBe(0); // still open
    // Reveal one tile: a mine settles the round; otherwise cash out, which settles it.
    const r = await actOnRound({ userId: p.userId, roundId: res.body.round.id, action: { type: 'reveal', tile: 0 }, idempotencyKey: key() });
    if (r.body.round.status === 'OPEN') await actOnRound({ userId: p.userId, roundId: res.body.round.id, action: { type: 'cashout' }, idempotencyKey: key() });
    expect((await bonusOverview(p.userId)).active!.wageringProgress).toBe(5_000);
    await expectLedgerConsistent();
  });

  it('the database refuses to rewrite a claim: terms, progress backwards, reopening, deleting', async () => {
    const c = await promo();
    const p = await newPlayer('guard');
    const res = await claimBonus(p.userId, { code: c.code! });
    await expectDbError(db().execute(sql`UPDATE bonus_claims SET amount = amount + 1 WHERE id = ${res.claimId}`), /immutable/);
    await db().execute(sql`UPDATE bonus_claims SET wagering_progress = 10 WHERE id = ${res.claimId}`);
    await expectDbError(db().execute(sql`UPDATE bonus_claims SET wagering_progress = 5 WHERE id = ${res.claimId}`), /cannot decrease/);
    await forfeitBonus(p.userId, res.claimId);
    await expectDbError(db().execute(sql`UPDATE bonus_claims SET status = 'ACTIVE', closed_at = NULL, close_tx_id = NULL WHERE id = ${res.claimId}`), /closed bonus claim/);
    await expectDbError(db().execute(sql`DELETE FROM bonus_claims WHERE id = ${res.claimId}`), /cannot be deleted/);
    await expectLedgerConsistent();
  });

  it('reconciliation catches bonus money that does not match the claims (faults injected in a rolled-back savepoint)', async () => {
    const { runChecksWith } = await import('@/server/jobs/reconciliation');
    const { getPool } = await import('@/server/db/client');
    const c = await promo();
    const p = await newPlayer('tamper');
    const claimed = await claimBonus(p.userId, { code: c.code! });
    const [locked] = await db().select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.code, SYSTEM_ACCOUNTS.BONUS_LOCKED.code));
    const [promos] = await db().select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.code, SYSTEM_ACCOUNTS.PROMOTIONS.code));
    const wallet = (await getWalletAccount(db(), p.userId))!.id;
    const client = await getPool().connect();
    const failing = async (inject: () => Promise<unknown>) => {
      await client.query('BEGIN');
      try {
        await inject();
        return (await runChecksWith(client)).filter((r) => r.mismatches > 0).map((r) => r.name);
      } finally {
        await client.query('ROLLBACK');
      }
    };
    const tx = async (type: string, entries: [number, number][]) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ledger_transactions (type, idempotency_key, user_id, description) VALUES ($1, $2, $3, 'injected fault') RETURNING id`,
        [type, `fault:${key()}`, p.userId],
      );
      for (const [account, amount] of entries) await client.query('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES ($1, $2, $3)', [rows[0]!.id, account, amount]);
      return Number(rows[0]!.id);
    };
    try {
      // Locked credits with no claim behind them.
      expect(await failing(() => tx('BONUS_CLAIMED', [[promos!.id, -500], [locked!.id, 500]]))).toEqual(
        expect.arrayContaining(['bonus_locked_matches_active_claims', 'bonus_claims_match_ledger']),
      );
      // A claim marked complete and paid out although its wagering was not met.
      expect(
        await failing(async () => {
          const release = await tx('BONUS_RELEASED', [[locked!.id, -50_000], [wallet, 50_000]]);
          await client.query(`UPDATE bonus_claims SET status = 'COMPLETED', closed_at = now(), close_tx_id = $1 WHERE id = $2`, [release, claimed.claimId]);
        }),
      ).toContain('bonus_claims_match_ledger');
    } finally {
      client.release();
    }
    await expectLedgerConsistent();
  });
});
