/**
 * Cashier against the sandbox provider: deposits are credited only by a
 * verified, de-duplicated settlement webhook; withdrawals hold the amount,
 * pass review (two approvers for large amounts), and either pay out or
 * return the money; every movement reconciles.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as cashierRoute } from '@/app/api/cashier/route';
import * as depositsRoute from '@/app/api/cashier/deposits/route';
import { GET as depositRoute } from '@/app/api/cashier/deposits/[depositId]/route';
import { POST as depositCancelRoute } from '@/app/api/cashier/deposits/[depositId]/cancel/route';
import { POST as checkoutRoute } from '@/app/api/cashier/deposits/[depositId]/sandbox/route';
import { POST as webhookRoute } from '@/app/api/payments/webhooks/[provider]/route';
import { POST as reviewRoute } from '@/app/api/admin/payments/withdrawals/[withdrawalId]/review/route';
import { GET as queueRoute } from '@/app/api/admin/payments/withdrawals/route';
import * as settingsRoute from '@/app/api/admin/payments/settings/route';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { getDb, getPool } from '@/server/db/client';
import { bonusCampaigns, bonusClaims, deposits, ledgerTransactions, notifications, paymentEvents, users, withdrawals, type UserRole } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { AppError } from '@/server/errors';
import { getWalletAccount, systemAccountIds } from '@/server/ledger/accounts';
import { runChecksWith } from '@/server/jobs/reconciliation';
import { cancelDeposit, createDeposit, expireDeposits } from '@/server/payments/deposits';
import { failDepositUnderReview } from '@/server/payments/admin';
import { sandboxDelivery, signSandbox, SIGNATURE_HEADER } from '@/server/payments/providers/sandbox';
import { sandboxCheckout, sandboxSettlePayout, settleSandboxPayouts } from '@/server/payments/sandbox-actions';
import { handleWebhook } from '@/server/payments/webhooks';
import { cancelWithdrawal, requestWithdrawal, reviewWithdrawal, withdrawalOptions } from '@/server/payments/withdrawals';
import { getLimits, selfExclude, updateLimits } from '@/server/responsible/limits';
import { withTransaction } from '@/server/db/client';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
async function rejects(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected the call to be refused');
}

async function staff(role: UserRole) {
  const p = await newPlayer(role.toLowerCase().slice(0, 4));
  await getDb().update(users).set({ role }).where(eq(users.id, p.userId));
  return { ...p, ctx: { adminId: p.userId, ipHash: null, requestId: key() } };
}

async function depositRow(id: string) {
  return (await getDb().select().from(deposits).where(eq(deposits.id, id)))[0]!;
}
async function withdrawalRow(id: string) {
  return (await getDb().select().from(withdrawals).where(eq(withdrawals.id, id)))[0]!;
}

/** A verified player with one completed sandbox-card deposit (so the closed-loop rule allows card withdrawals). */
async function fundedPlayer(prefix: string, amount = 10_000) {
  const p = await newPlayer(prefix);
  const dep = await createDeposit(p.userId, { methodId: 'sandbox-card', amount }, key());
  await sandboxCheckout(p.userId, dep.deposit.id, 'pay');
  await getDb().update(users).set({ kycStatus: 'VERIFIED' }).where(eq(users.id, p.userId));
  return p;
}

afterEach(() => {
  delete process.env.PAYMENTS_MODE;
  resetEnvCache();
});

describe('deposits', () => {
  it('starting a deposit moves no money; only the verified settlement credits the wallet, once', async () => {
    const p = await newPlayer('dep');
    const before = await balance(p.userId);
    const started = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 25_000 }, key());
    expect(started.deposit.status).toBe('PENDING');
    expect(started.redirectUrl).toContain(`/wallet/sandbox-checkout/${started.deposit.id}`);
    expect(started.deposit.sandbox).toBe(true);
    // Nothing is credited for a started (or "successful-looking") deposit.
    expect(await balance(p.userId)).toBe(before);

    const res = await sandboxCheckout(p.userId, started.deposit.id, 'pay');
    expect(res.result).toBe('completed');
    expect(await balance(p.userId)).toBe(before + 25_000);
    const row = await depositRow(started.deposit.id);
    expect(row.status).toBe('COMPLETED');
    const [tx] = await getDb().select().from(ledgerTransactions).where(eq(ledgerTransactions.id, row.ledgerTxId!));
    expect(tx!.type).toBe('DEPOSIT');
    // The player is told, without any sensitive data.
    const [n] = await getDb().select().from(notifications).where(eq(notifications.userId, p.userId));
    expect(n!.title).toBe('Deposit received');
    expect(n!.body).toContain('sandbox, no real money');

    // Paying again is refused: the deposit is final.
    expect(code(await rejects(sandboxCheckout(p.userId, started.deposit.id, 'pay')))).toBe('CONFLICT');
    expect(await balance(p.userId)).toBe(before + 25_000);
    await expectLedgerConsistent();
  });

  it('a replayed webhook (same event id) and a second settlement event (new id) never credit twice', async () => {
    const p = await newPlayer('replay');
    const before = await balance(p.userId);
    const d = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 10_000 }, key());
    const ref = (await depositRow(d.deposit.id)).providerReference!;
    const delivery = sandboxDelivery({ type: 'deposit.completed', reference: ref, amount: 10_000, currency: 'CHIP' });
    const [a, b] = await Promise.all([handleWebhook('sandbox', delivery.body, delivery.headers), handleWebhook('sandbox', delivery.body, delivery.headers)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body, b.body].filter((x) => 'duplicate' in x && x.duplicate)).toHaveLength(1);
    const again = await handleWebhook('sandbox', delivery.body, delivery.headers);
    expect(again.body).toMatchObject({ received: true, duplicate: true });
    const other = sandboxDelivery({ type: 'deposit.completed', reference: ref, amount: 10_000, currency: 'CHIP' });
    expect((await handleWebhook('sandbox', other.body, other.headers)).body).toMatchObject({ duplicate: false, result: 'ignored: already completed' });
    expect(await balance(p.userId)).toBe(before + 10_000);
    await expectLedgerConsistent();
  });

  it('forged, tampered and stale deliveries are rejected, logged, and change nothing', async () => {
    const p = await newPlayer('forge');
    const before = await balance(p.userId);
    const d = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 10_000 }, key());
    const ref = (await depositRow(d.deposit.id)).providerReference!;
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'deposit.completed', reference: ref, amount: 10_000, currency: 'CHIP' });
    const now = Math.floor(Date.now() / 1000);

    const unsigned = await handleWebhook('sandbox', body, new Headers());
    expect(unsigned.status).toBe(400);
    const wrongKey = await handleWebhook('sandbox', body, new Headers({ [SIGNATURE_HEADER]: signSandbox(body, now, 'x'.repeat(64)) }));
    expect(wrongKey.status).toBe(400);
    // Signed, then the amount changed in transit.
    const signed = signSandbox(body, now);
    const tampered = await handleWebhook('sandbox', body.replace('"amount":10000', '"amount":99000'), new Headers({ [SIGNATURE_HEADER]: signed }));
    expect(tampered.status).toBe(400);
    // A genuine signature from ten minutes ago (a captured delivery replayed later).
    const stale = await handleWebhook('sandbox', body, new Headers({ [SIGNATURE_HEADER]: signSandbox(body, now - 600) }));
    expect(stale).toMatchObject({ status: 400, body: { error: 'stale signature timestamp' } });
    // Unknown provider.
    expect((await handleWebhook('nope', body, new Headers({ [SIGNATURE_HEADER]: signed }))).status).toBe(404);

    expect(await balance(p.userId)).toBe(before);
    expect((await depositRow(d.deposit.id)).status).toBe('PENDING');
    const logged = await getDb().select().from(paymentEvents).where(eq(paymentEvents.signatureValid, false));
    expect(logged.length).toBeGreaterThanOrEqual(4);
    // The genuine delivery still works afterwards.
    expect((await handleWebhook('sandbox', body, new Headers({ [SIGNATURE_HEADER]: signed }))).body).toMatchObject({ result: 'completed' });
    expect(await balance(p.userId)).toBe(before + 10_000);
  });

  it('a settlement for another amount puts the deposit under review; staff can fail it but never credit it', async () => {
    const p = await newPlayer('mismatch');
    const finance = await staff('FINANCE_MANAGER');
    const before = await balance(p.userId);
    const d = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 10_000 }, key());
    const ref = (await depositRow(d.deposit.id)).providerReference!;
    const off = sandboxDelivery({ type: 'deposit.completed', reference: ref, amount: 9_000, currency: 'CHIP' });
    expect((await handleWebhook('sandbox', off.body, off.headers)).body).toMatchObject({ result: 'under review: amount or currency mismatch' });
    expect((await depositRow(d.deposit.id)).status).toBe('UNDER_REVIEW');
    expect(await balance(p.userId)).toBe(before);
    // The player cannot resolve their own deposit; finance closes it as failed.
    expect(code(await rejects(failDepositUnderReview({ adminId: p.userId, ipHash: null, requestId: key() }, d.deposit.id, 'Self review attempt')))).toBe('FORBIDDEN');
    await failDepositUnderReview(finance.ctx, d.deposit.id, 'Amount did not match; refunded through the provider');
    expect((await depositRow(d.deposit.id)).status).toBe('FAILED');
    expect(await balance(p.userId)).toBe(before);
  });

  it('declined and abandoned checkouts credit nothing; idempotent creation; method bounds', async () => {
    const p = await newPlayer('decline');
    const before = await balance(p.userId);
    const k = key();
    const a = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, k);
    const replay = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, k);
    expect(replay).toMatchObject({ replayed: true, deposit: { id: a.deposit.id } });
    expect(code(await rejects(createDeposit(p.userId, { methodId: 'sandbox-card', amount: 6_000 }, k)))).toBe('CONFLICT');
    await sandboxCheckout(p.userId, a.deposit.id, 'decline');
    expect((await depositRow(a.deposit.id)).status).toBe('FAILED');
    const b = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key());
    await cancelDeposit(p.userId, b.deposit.id);
    expect((await depositRow(b.deposit.id)).status).toBe('CANCELLED');
    expect(await balance(p.userId)).toBe(before);
    // Below the method minimum, above its maximum, unknown method.
    expect(code(await rejects(createDeposit(p.userId, { methodId: 'sandbox-card', amount: 999 }, key())))).toBe('VALIDATION_ERROR');
    expect(code(await rejects(createDeposit(p.userId, { methodId: 'sandbox-card', amount: 200_001 }, key())))).toBe('VALIDATION_ERROR');
    expect(code(await rejects(createDeposit(p.userId, { methodId: 'no-such-method', amount: 5_000 }, key())))).toBe('VALIDATION_ERROR');
    // A player cannot pay someone else's deposit.
    const other = await newPlayer('other');
    const c = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key());
    expect(code(await rejects(sandboxCheckout(other.userId, c.deposit.id, 'pay')))).toBe('NOT_FOUND');
  });

  it("the player's own deposit limit and self-exclusion are enforced", async () => {
    const p = await newPlayer('limit');
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyDepositLimit: 20_000 }));
    expect((await getLimits(getDb(), p.userId)).limits.dailyDepositLimit).toBe(20_000);
    await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 15_000 }, key());
    // 15,000 requested (pending counts) + 6,000 > 20,000.
    const over = await rejects(createDeposit(p.userId, { methodId: 'sandbox-card', amount: 6_000 }, key()));
    expect(over.code).toBe('RESPONSIBLE_GAMING');
    expect(over.message).toContain('50');
    await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key());

    const q = await newPlayer('excluded');
    await withTransaction((tx) => selfExclude(tx, q.userId, 6));
    expect((await rejects(createDeposit(q.userId, { methodId: 'sandbox-card', amount: 5_000 }, key()))).message).toContain('self-excluded');
  });

  it('an unpaid deposit expires; a matching late settlement is still credited (the money is the player’s)', async () => {
    const p = await newPlayer('expire');
    const before = await balance(p.userId);
    const d = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 8_000 }, key());
    expect(await expireDeposits(new Date(Date.now() + 31 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await depositRow(d.deposit.id)).status).toBe('EXPIRED');
    expect(code(await rejects(sandboxCheckout(p.userId, d.deposit.id, 'pay')))).toBe('CONFLICT');
    const ref = (await depositRow(d.deposit.id)).providerReference!;
    const late = sandboxDelivery({ type: 'deposit.completed', reference: ref, amount: 8_000, currency: 'CHIP' });
    expect((await handleWebhook('sandbox', late.body, late.headers)).body).toMatchObject({ result: 'completed' });
    expect((await depositRow(d.deposit.id)).status).toBe('COMPLETED');
    expect(await balance(p.userId)).toBe(before + 8_000);
    await expectLedgerConsistent();
  });

  it('a first-deposit bonus is granted on settlement only when opted in, locked, with its wagering terms', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [campaign] = await getDb()
      .insert(bonusCampaigns)
      .values({ slug: `first-${suffix}`, kind: 'DEPOSIT', name: 'First deposit 100%', description: 'Test', matchPercent: 100, fixedAmount: 0, maxBonus: 30_000, wageringMultiplier: 10, expiresAfterDays: 7, depositNumber: 1, minDeposit: 2_000 })
      .returning();
    const p = await newPlayer('bonus');
    const before = await balance(p.userId);
    const d = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 40_000, bonusCampaignId: campaign!.id }, key());
    // Nothing is granted before the money arrives.
    expect(await getDb().select().from(bonusClaims).where(eq(bonusClaims.userId, p.userId))).toHaveLength(0);
    expect((await sandboxCheckout(p.userId, d.deposit.id, 'pay')).result).toBe('completed; bonus 30000');
    const [claim] = await getDb().select().from(bonusClaims).where(eq(bonusClaims.userId, p.userId));
    expect(claim).toMatchObject({ amount: 30_000, depositId: d.deposit.id, wageringRequired: 300_000, status: 'ACTIVE' });
    // The deposit is spendable; the bonus is locked.
    expect(await balance(p.userId)).toBe(before + 40_000);
    // It was a first-deposit offer: the second deposit cannot take it.
    expect(code(await rejects(createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000, bonusCampaignId: campaign!.id }, key())))).toBe('CONFLICT');
    await getDb().update(bonusCampaigns).set({ active: false }).where(eq(bonusCampaigns.id, campaign!.id));
    await expectLedgerConsistent();
  });

  it('in disabled mode nothing can be started and webhooks are refused', async () => {
    const p = await newPlayer('off');
    process.env.PAYMENTS_MODE = 'disabled';
    resetEnvCache();
    expect(code(await rejects(createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key())))).toBe('SERVICE_UNAVAILABLE');
    const delivery = sandboxDelivery({ type: 'deposit.completed', reference: 'sbx_dep_x', amount: 5_000, currency: 'CHIP' });
    expect((await handleWebhook('sandbox', delivery.body, delivery.headers)).status).toBe(503);
    expect((await withdrawalOptions(p.userId)).blockers).toContain('Payments are not available on this site.');
  });
});

describe('withdrawals', () => {
  it('every blocker is stated: identity verification, closed loop, balance, method bounds', async () => {
    const p = await newPlayer('wblock');
    const opts = await withdrawalOptions(p.userId);
    expect(opts.blockers).toContain('Verify your identity before withdrawing (Account → Verification). This is required once.');
    expect(opts.methods.every((m) => !m.available && m.reason?.includes('completed a deposit'))).toBe(true);
    expect(code(await rejects(requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key())))).toBe('CONFLICT');

    const q = await fundedPlayer('wbounds');
    const o = await withdrawalOptions(q.userId);
    expect(o.blockers).toEqual([]);
    expect(o.methods.find((m) => m.id === 'sandbox-card')!.available).toBe(true);
    expect(o.methods.find((m) => m.id === 'sandbox-bank')!.available).toBe(false);
    expect(code(await rejects(requestWithdrawal(q.userId, { methodId: 'sandbox-bank', amount: 10_000 }, key())))).toBe('CONFLICT');
    expect(code(await rejects(requestWithdrawal(q.userId, { methodId: 'sandbox-card', amount: 1_999 }, key())))).toBe('VALIDATION_ERROR');
    expect(code(await rejects(requestWithdrawal(q.userId, { methodId: 'sandbox-card', amount: 500_001 }, key())))).toBe('VALIDATION_ERROR');
  });

  it('a player cannot withdraw more than their balance', async () => {
    const p = await fundedPlayer('wbal');
    // Spend down to a small balance through a withdrawal held for review, then ask for more than is left.
    const all = await balance(p.userId);
    await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 450_000 }, key());
    await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 450_000 }, key());
    const left = await balance(p.userId);
    expect(left).toBe(all - 900_000);
    expect(code(await rejects(requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: left + 1 }, key())))).toBe('INSUFFICIENT_FUNDS');
    expect(await balance(p.userId)).toBe(left);
  });

  it('below the review threshold: held at once, paid by the provider settlement, reconciled', async () => {
    const p = await fundedPlayer('wpay');
    const before = await balance(p.userId);
    const r = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 50_000 }, key());
    expect(r.withdrawal.status).toBe('PROCESSING');
    // The amount left the spendable balance immediately.
    expect(await balance(p.userId)).toBe(before - 50_000);
    // The automatic sandbox settlement waits a minute; settling "later" pays it.
    expect(await settleSandboxPayouts(new Date(Date.now() + 2 * 60_000))).toBeGreaterThanOrEqual(1);
    const row = await withdrawalRow(r.withdrawal.id);
    expect(row.status).toBe('COMPLETED');
    expect(await balance(p.userId)).toBe(before - 50_000);
    expect(code(await rejects(cancelWithdrawal(p.userId, r.withdrawal.id)))).toBe('CONFLICT');
    await expectLedgerConsistent();
  });

  it('above the threshold: finance review; the player and the first approver cannot decide; two approvers for large amounts', async () => {
    const p = await fundedPlayer('wreview');
    const f1 = await staff('FINANCE_MANAGER');
    const f2 = await staff('FINANCE_MANAGER');
    const before = await balance(p.userId);

    const mid = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 100_000 }, key());
    expect(mid.withdrawal.status).toBe('UNDER_REVIEW');
    expect(await balance(p.userId)).toBe(before - 100_000);
    expect(code(await rejects(reviewWithdrawal({ adminId: p.userId, ipHash: null, requestId: key() }, mid.withdrawal.id, 'approve', 'Approving my own')))).toBe('FORBIDDEN');
    const approved = await reviewWithdrawal(f1.ctx, mid.withdrawal.id, 'approve', 'Checked: verified account, normal play');
    expect(approved.step).toBe('approved');
    expect(approved.withdrawal.status).toBe('PROCESSING');

    const big = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 500_000 }, key());
    expect(big.withdrawal.status).toBe('UNDER_REVIEW');
    const first = await reviewWithdrawal(f1.ctx, big.withdrawal.id, 'approve', 'First approval of a large withdrawal');
    expect(first).toMatchObject({ step: 'first_approval', withdrawal: { status: 'UNDER_REVIEW' } });
    expect(code(await rejects(reviewWithdrawal(f1.ctx, big.withdrawal.id, 'approve', 'Approving twice myself')))).toBe('FORBIDDEN');
    const second = await reviewWithdrawal(f2.ctx, big.withdrawal.id, 'approve', 'Second approval, different person');
    expect(second).toMatchObject({ step: 'approved', withdrawal: { status: 'PROCESSING' } });
    const row = await withdrawalRow(big.withdrawal.id);
    expect(row.firstApprovedBy).toBe(f1.userId);
    expect(row.reviewedBy).toBe(f2.userId);
    await expectLedgerConsistent();
  });

  it('rejected, cancelled and failed withdrawals return the full amount to the wallet', async () => {
    const p = await fundedPlayer('wreturn');
    const finance = await staff('FINANCE_MANAGER');
    const start = await balance(p.userId);

    const toReject = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 150_000 }, key());
    await reviewWithdrawal(finance.ctx, toReject.withdrawal.id, 'reject', 'Source of funds documents requested');
    expect((await withdrawalRow(toReject.withdrawal.id)).status).toBe('REJECTED');
    expect(await balance(p.userId)).toBe(start);

    const toCancel = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 120_000 }, key());
    await cancelWithdrawal(p.userId, toCancel.withdrawal.id);
    expect(await balance(p.userId)).toBe(start);

    const toFail = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 20_000 }, key());
    expect(toFail.withdrawal.status).toBe('PROCESSING');
    await sandboxSettlePayout(finance.ctx, toFail.withdrawal.id, 'failed');
    expect((await withdrawalRow(toFail.withdrawal.id)).status).toBe('FAILED');
    expect(await balance(p.userId)).toBe(start);
    // A payout event for a closed withdrawal is ignored.
    const late = sandboxDelivery({ type: 'payout.completed', reference: (await withdrawalRow(toFail.withdrawal.id)).providerReference!, amount: 20_000, currency: 'CHIP' });
    expect((await handleWebhook('sandbox', late.body, late.headers)).body).toMatchObject({ result: 'ignored: withdrawal is failed' });
    expect(await balance(p.userId)).toBe(start);
    await expectLedgerConsistent();
  });

  it('concurrent requests cannot withdraw more than the balance', async () => {
    const p = await fundedPlayer('wrace');
    const all = await balance(p.userId);
    const amount = Math.min(400_000, all);
    const results = await Promise.allSettled([0, 1, 2].map(() => requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount }, key())));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const expected = Math.floor(all / amount);
    expect(ok.length).toBe(Math.min(3, expected));
    expect(await balance(p.userId)).toBe(all - ok.length * amount);
    await expectLedgerConsistent();
  });

  it('reconciliation catches cashier money that does not match deposits and withdrawals (faults in a rolled-back transaction)', async () => {
    const p = await fundedPlayer('wtamper');
    const held = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 150_000 }, key());
    const ids = await systemAccountIds(getDb());
    const wallet = (await getWalletAccount(getDb(), p.userId))!.id;
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
      expect(await failing(async () => undefined)).toEqual([]);
      // A wallet credited as a "deposit" with no settled deposit behind it.
      expect(await failing(() => tx('DEPOSIT', [[ids.PAYMENT_CLEARING, -70_000], [wallet, 70_000]]))).toContain('deposits_match_ledger');
      // Held withdrawal money quietly moved back to the wallet while the withdrawal stays open.
      expect(await failing(() => tx('WITHDRAWAL_RELEASED', [[ids.PENDING_WITHDRAWALS, -150_000], [wallet, 150_000]]))).toEqual(
        expect.arrayContaining(['pending_withdrawals_match_open', 'withdrawals_match_ledger']),
      );
      // A payout that keeps a fee the withdrawal never declared (the player was promised the full amount).
      expect(
        await failing(async () => {
          await client.query(`UPDATE withdrawals SET status = 'APPROVED' WHERE id = $1`, [held.withdrawal.id]);
          const paid = await tx('WITHDRAWAL_PAID', [[ids.PENDING_WITHDRAWALS, -150_000], [ids.PAYMENT_CLEARING, 149_000], [ids.PAYMENT_FEES, 1_000]]);
          await client.query(`UPDATE withdrawals SET status = 'COMPLETED', close_tx_id = $1, completed_at = now() WHERE id = $2`, [paid, held.withdrawal.id]);
        }),
      ).toContain('withdrawals_match_ledger');
    } finally {
      client.release();
    }
    await expectLedgerConsistent();
  });
});

describe('cashier API: authentication, CSRF, strict bodies, ownership, permissions', () => {
  const BASE = 'http://localhost:3000';
  function req(path: string, opts: { method?: string; body?: unknown; token?: string; origin?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { 'x-forwarded-for': `10.77.${randomInt(250)}.${randomInt(250)}`, ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['content-type'] ??= 'application/json';
    if (opts.token) headers.cookie = `${SESSION_COOKIE_DEV}=${opts.token}`;
    if (opts.method && opts.method !== 'GET') {
      headers.origin = opts.origin ?? BASE;
      headers['idempotency-key'] ??= randomUUID();
    }
    return new NextRequest(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) });
  }
  const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

  it('needs a session, refuses cross-site requests, and never accepts client-chosen money fields', async () => {
    expect((await cashierRoute(req('/api/cashier'), params({}))).status).toBe(401);
    expect((await depositsRoute.POST(req('/api/cashier/deposits', { method: 'POST', body: { methodId: 'sandbox-card', amount: 5_000 } }), params({}))).status).toBe(401);
    const p = await newPlayer('api');
    const before = await balance(p.userId);
    const foreign = await depositsRoute.POST(req('/api/cashier/deposits', { method: 'POST', token: p.token, origin: 'https://evil.example', body: { methodId: 'sandbox-card', amount: 5_000 } }), params({}));
    expect(foreign.status).toBe(403);
    // Extra fields such as a credited amount or a status are refused outright.
    for (const extra of [{ credited: 9_999_999 }, { status: 'COMPLETED' }, { fee: 0 }]) {
      const res = await depositsRoute.POST(req('/api/cashier/deposits', { method: 'POST', token: p.token, body: { methodId: 'sandbox-card', amount: 5_000, ...extra } }), params({}));
      expect(res.status).toBe(400);
    }
    const ok = await depositsRoute.POST(req('/api/cashier/deposits', { method: 'POST', token: p.token, body: { methodId: 'sandbox-card', amount: 5_000 } }), params({}));
    expect(ok.status).toBe(200);
    const created = await ok.json();
    expect(created.deposit.status).toBe('PENDING');
    expect(await balance(p.userId)).toBe(before);
    // The cashier summary is computed on the server.
    const opts = await (await cashierRoute(req('/api/cashier', { token: p.token }), params({}))).json();
    expect(opts.deposit.methods.map((m: { id: string }) => m.id)).toEqual(['sandbox-card', 'sandbox-bank', 'sandbox-wallet']);
    expect(opts.withdrawal.blockers.length).toBeGreaterThan(0);

    // Another player can neither read, cancel nor pay it.
    const other = await newPlayer('api-other');
    expect((await depositRoute(req(`/api/cashier/deposits/${created.deposit.id}`, { token: other.token }), params({ depositId: created.deposit.id }))).status).toBe(404);
    expect((await depositCancelRoute(req(`/api/cashier/deposits/${created.deposit.id}/cancel`, { method: 'POST', token: other.token, body: {} }), params({ depositId: created.deposit.id }))).status).toBe(404);
    expect((await checkoutRoute(req(`/api/cashier/deposits/${created.deposit.id}/sandbox`, { method: 'POST', token: other.token, body: { outcome: 'pay' } }), params({ depositId: created.deposit.id }))).status).toBe(404);
    expect(await balance(p.userId)).toBe(before);
  });

  it('the webhook endpoint is public but only signed deliveries do anything', async () => {
    const p = await newPlayer('api-hook');
    const before = await balance(p.userId);
    const d = await createDeposit(p.userId, { methodId: 'sandbox-card', amount: 5_000 }, key());
    const ref = (await depositRow(d.deposit.id)).providerReference!;
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'deposit.completed', reference: ref, amount: 5_000, currency: 'CHIP' });
    // No Origin (server to server) is fine; a bad signature is still refused.
    const forged = await webhookRoute(req('/api/payments/webhooks/sandbox', { method: 'POST', body, headers: { [SIGNATURE_HEADER]: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` } }), params({ provider: 'sandbox' }));
    expect(forged.status).toBe(400);
    expect(await balance(p.userId)).toBe(before);
    const signed = await webhookRoute(req('/api/payments/webhooks/sandbox', { method: 'POST', body, headers: { [SIGNATURE_HEADER]: signSandbox(body, Math.floor(Date.now() / 1000)) } }), params({ provider: 'sandbox' }));
    expect(signed.status).toBe(200);
    expect(await balance(p.userId)).toBe(before + 5_000);
  });

  it('only finance staff decide withdrawals; only admins change cashier rules', async () => {
    const p = await fundedPlayer('api-review');
    const w = await requestWithdrawal(p.userId, { methodId: 'sandbox-card', amount: 120_000 }, key());
    const support = await staff('SUPPORT');
    const auditor = await staff('AUDITOR');
    const finance = await staff('FINANCE_MANAGER');
    const admin = await staff('ADMIN');
    const decide = (token: string) =>
      reviewRoute(req(`/api/admin/payments/withdrawals/${w.withdrawal.id}/review`, { method: 'POST', token, body: { decision: 'approve', note: 'Checked and approved' } }), params({ withdrawalId: w.withdrawal.id }));
    expect((await decide(p.token)).status).toBe(403);
    expect((await decide(support.token)).status).toBe(403);
    expect((await decide(auditor.token)).status).toBe(403);
    // Auditors may read the queue.
    expect((await queueRoute(req('/api/admin/payments/withdrawals', { token: auditor.token }), params({}))).status).toBe(200);
    expect((await queueRoute(req('/api/admin/payments/withdrawals', { token: support.token }), params({}))).status).toBe(403);
    expect((await decide(finance.token)).status).toBe(200);

    const patch = (token: string) => settingsRoute.PATCH(req('/api/admin/payments/settings', { method: 'PATCH', token, body: { patch: { withdrawalCooldownMinutes: 0 }, reason: 'No change, permission probe' } }), params({}));
    expect((await patch(finance.token)).status).toBe(403);
    expect((await patch(admin.token)).status).toBe(200);
  });
});
