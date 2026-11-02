/**
 * Withdrawals. The requested amount is moved out of the wallet into
 * PENDING_WITHDRAWALS at once (it can no longer be wagered), then:
 *
 *   REQUESTED → PENDING (below the review threshold) → APPROVED → PROCESSING → COMPLETED
 *            ↘ UNDER_REVIEW (staff) → APPROVED … | REJECTED
 *   Player may CANCEL until the payout is sent; a failed payout is FAILED.
 *   REJECTED, CANCELLED and FAILED return the amount to the wallet.
 *
 * Every reason a withdrawal is unavailable is computed here and shown to the
 * player as is. There are no hidden conditions, and no deposit is ever
 * required to unlock money the player already has. The closed-loop rule
 * (withdraw to a method you have deposited with) is an anti-money-laundering
 * rule the operator can switch off, and it is shown as such.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import { audit, recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction, type Executor, type Tx } from '../db/client';
import { deposits, paymentMethods, users, withdrawals, type WithdrawalStatus } from '../db/schema';
import { AppError, errors } from '../errors';
import { lockWalletAccount, getWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { notify } from '../notifications/notifications';
import { openRiskFlagCount } from '../kyc/kyc';
import { lockedBonus } from '../promotions/campaigns';
import { feeFor, getCashierSettings, paymentsMode, platformCurrency } from './config';
import { getProvider } from './providers';

const DAY = 86_400_000;
/** Withdrawals that still hold money (count against limits; block a new request's cooldown). */
const OPEN: WithdrawalStatus[] = ['REQUESTED', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'];
const RETURNED: WithdrawalStatus[] = ['REJECTED', 'CANCELLED', 'FAILED'];

export type WithdrawalRow = typeof withdrawals.$inferSelect;

export function withdrawalView(w: WithdrawalRow, methodName?: string) {
  return {
    id: w.id,
    method: methodName ?? w.methodId,
    methodId: w.methodId,
    sandbox: w.sandbox,
    amount: w.amount,
    fee: w.fee,
    payout: w.payout,
    currency: w.currency,
    status: w.status,
    reference: w.providerReference,
    reviewNote: w.reviewNote,
    approvals: (w.firstApprovedBy ? 1 : 0) + (w.reviewedBy && ['APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(w.status) ? 1 : 0),
    failureReason: w.failureReason,
    requestedAt: w.requestedAt.toISOString(),
    completedAt: w.completedAt?.toISOString() ?? null,
    cancellable: ['REQUESTED', 'PENDING', 'UNDER_REVIEW', 'APPROVED'].includes(w.status),
  };
}

async function withdrawnSince(db: Executor, userId: string, since: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`coalesce(sum(${withdrawals.amount}), 0)::text` })
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, userId), notInArray(withdrawals.status, RETURNED), gt(withdrawals.requestedAt, since)));
  return Number(r?.n ?? 0);
}

/** Methods the player may withdraw to, each with the reason it is unavailable (if it is). */
async function methodsFor(db: Executor, userId: string, closedLoop: boolean) {
  const methods = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.active, true), eq(paymentMethods.withdrawalEnabled, true)))
    .orderBy(asc(paymentMethods.sortOrder));
  const used = new Set(
    (await db.selectDistinct({ m: deposits.methodId }).from(deposits).where(and(eq(deposits.userId, userId), eq(deposits.status, 'COMPLETED')))).map((r) => r.m),
  );
  return methods.map((m) => ({
    method: m,
    reason: closedLoop && !used.has(m.id) ? 'Withdrawals go back to a method you have completed a deposit with (anti-money-laundering rule).' : null,
  }));
}

/** Eligibility, computed the same way for the form and (under the wallet lock) for the request. */
async function eligibility(db: Executor, userId: string, now: Date) {
  const settings = await getCashierSettings(db);
  const [u] = await db.select({ status: users.status, kyc: users.kycStatus }).from(users).where(eq(users.id, userId));
  const blockers: string[] = [];
  if (paymentsMode() === 'disabled') blockers.push('Payments are not available on this site.');
  if (u?.status !== 'ACTIVE') blockers.push('Withdrawals are not available while your account is suspended. Contact support.');
  if (settings.kycRequiredForWithdrawal && u?.kyc !== 'VERIFIED') blockers.push('Verify your identity before withdrawing (Account → Verification). This is required once.');
  const [lastAny] = await db
    .select({ at: sql<string | null>`max(${withdrawals.requestedAt})::text` })
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, userId), notInArray(withdrawals.status, RETURNED)));
  const last = lastAny?.at ? new Date(lastAny.at) : null;
  const cooldownMs = settings.withdrawalCooldownMinutes * 60_000;
  if (cooldownMs > 0 && last && now.getTime() - last.getTime() < cooldownMs) {
    blockers.push(`One withdrawal every ${settings.withdrawalCooldownMinutes} minutes. The next is possible from ${new Date(last.getTime() + cooldownMs).toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
  }
  const usedDay = await withdrawnSince(db, userId, new Date(now.getTime() - DAY));
  const usedMonth = await withdrawnSince(db, userId, new Date(now.getTime() - 30 * DAY));
  const remaining = Math.max(0, Math.min(settings.dailyWithdrawalLimit - usedDay, settings.monthlyWithdrawalLimit - usedMonth));
  if (remaining <= 0) blockers.push('You have reached the withdrawal limit for now (daily or monthly).');
  const methods = await methodsFor(db, userId, settings.closedLoop);
  if (methods.length === 0) blockers.push('No withdrawal method is available.');
  else if (methods.every((m) => m.reason)) blockers.push(methods[0]!.reason!);
  return { settings, kyc: u?.kyc ?? 'NOT_STARTED', blockers, usedDay, usedMonth, remaining, methods };
}

/** Everything the withdrawal form shows: balance, what can be withdrawn, limits, fees, and every blocker. */
export async function withdrawalOptions(userId: string, now = new Date()) {
  const db = getDb();
  const e = await eligibility(db, userId, now);
  const balance = (await getWalletAccount(db, userId))?.balance ?? 0;
  const [pending] = await db
    .select({ n: sql<string>`coalesce(sum(${withdrawals.amount}), 0)::text` })
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, userId), inArray(withdrawals.status, OPEN)));
  const blockers = balance <= 0 ? [...e.blockers, 'Your wallet balance is 0.'] : e.blockers;
  return {
    mode: paymentsMode(),
    currency: platformCurrency(),
    balance,
    withdrawable: Math.max(0, Math.min(balance, e.remaining)),
    lockedBonus: await lockedBonus(db, userId),
    pending: Number(pending?.n ?? 0),
    limits: { daily: e.settings.dailyWithdrawalLimit, monthly: e.settings.monthlyWithdrawalLimit, usedDay: e.usedDay, usedMonth: e.usedMonth, remaining: e.remaining },
    reviewThreshold: e.settings.reviewThreshold,
    closedLoop: e.settings.closedLoop,
    kyc: { required: e.settings.kycRequiredForWithdrawal, status: e.kyc },
    blockers,
    methods: e.methods.map(({ method: m, reason }) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      sandbox: m.sandbox,
      min: m.minWithdrawal,
      max: m.maxWithdrawal,
      feeFixed: m.withdrawalFeeFixed,
      feeBp: m.withdrawalFeeBp,
      processingTime: m.processingTime,
      available: reason === null,
      reason,
    })),
  };
}

async function release(tx: Tx, w: WithdrawalRow, walletAccountId: number, status: 'REJECTED' | 'CANCELLED' | 'FAILED', reason: string, now: Date, extra: Partial<typeof withdrawals.$inferInsert> = {}) {
  const ids = await systemAccountIds(tx);
  const posted = await postTransaction(tx, {
    type: 'WITHDRAWAL_RELEASED',
    idempotencyKey: `withdrawal:${w.id}:close`,
    userId: w.userId,
    description: `Withdrawal ${status.toLowerCase()} — amount returned to your wallet`,
    postings: [
      { accountId: ids.PENDING_WITHDRAWALS, amount: -w.amount },
      { accountId: walletAccountId, amount: w.amount },
    ],
    metadata: { withdrawalId: w.id, status },
  });
  await tx
    .update(withdrawals)
    .set({ status, closeTxId: posted.id, failureReason: status === 'FAILED' ? reason : w.failureReason, reviewNote: status === 'REJECTED' ? reason : w.reviewNote, updatedAt: now, ...extra })
    .where(eq(withdrawals.id, w.id));
  await notify(tx, w.userId, {
    kind: 'withdrawal',
    title: `Withdrawal ${status.toLowerCase()}`,
    body: `${(w.amount / 100).toFixed(2)} ${w.currency} is back in your wallet. ${reason}`.trim(),
    link: '/wallet/withdrawals',
  });
}

async function sendPayout(tx: Tx, w: WithdrawalRow, now: Date) {
  const provider = getProvider(w.provider);
  if (!provider) throw errors.conflict('The payout provider is not available.');
  const started = await provider.startPayout({ id: w.id, payout: w.payout, currency: w.currency, methodId: w.methodId });
  await tx.update(withdrawals).set({ status: 'PROCESSING', providerReference: started.reference, updatedAt: now }).where(eq(withdrawals.id, w.id));
}

/** Requests a withdrawal. Idempotent per player and key; refuses with the exact reason. */
export async function requestWithdrawal(userId: string, input: { methodId: string; amount: number }, idempotencyKey: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const wallet = await lockWalletAccount(tx, userId);
    const [existing] = await tx.select().from(withdrawals).where(and(eq(withdrawals.userId, userId), eq(withdrawals.idempotencyKey, idempotencyKey)));
    if (existing) {
      if (existing.methodId !== input.methodId || existing.amount !== input.amount) throw errors.conflict('This request key was already used for another withdrawal.');
      return { withdrawal: withdrawalView(existing), replayed: true };
    }
    const opts = await eligibility(tx, userId, now);
    if (opts.blockers.length) throw errors.conflict(opts.blockers[0]!, { blockers: opts.blockers });
    const m = opts.methods.find((x) => x.method.id === input.methodId);
    if (!m) throw errors.validation('This withdrawal method is not available.');
    if (m.reason) throw errors.conflict(m.reason);
    const method = m.method;
    if (input.amount < method.minWithdrawal) throw errors.validation(`The minimum withdrawal with ${method.name} is ${(method.minWithdrawal / 100).toFixed(2)}.`);
    if (input.amount > method.maxWithdrawal) throw errors.validation(`The maximum withdrawal with ${method.name} is ${(method.maxWithdrawal / 100).toFixed(2)} per request.`);
    if (input.amount > wallet.balance) throw new AppError('INSUFFICIENT_FUNDS', 'Your wallet balance is lower than this amount.', { balance: wallet.balance, requested: input.amount });
    if (input.amount > opts.remaining) throw errors.conflict(`This exceeds your withdrawal limit. You can withdraw up to ${(opts.remaining / 100).toFixed(2)} now.`);
    const fee = feeFor(input.amount, method.withdrawalFeeFixed, method.withdrawalFeeBp);
    if (fee >= input.amount) throw errors.validation('The amount does not cover the withdrawal fee.');
    const provider = getProvider(method.provider);
    if (!provider) throw errors.validation('This withdrawal method is not available.');

    const id = randomUUID();
    const ids = await systemAccountIds(tx);
    const hold = await postTransaction(tx, {
      type: 'WITHDRAWAL_HOLD',
      idempotencyKey: `withdrawal:${id}:hold`,
      userId,
      description: `Withdrawal requested${provider.sandbox ? ' (sandbox — no real money)' : ''}`,
      postings: [
        { accountId: wallet.id, amount: -input.amount },
        { accountId: ids.PENDING_WITHDRAWALS, amount: input.amount },
      ],
      metadata: { withdrawalId: id, method: method.id },
    });
    // An open compliance flag on the account sends every withdrawal to manual review.
    const review = opts.settings.reviewThreshold === 0 || input.amount >= opts.settings.reviewThreshold || (await openRiskFlagCount(tx, userId)) > 0;
    const [row] = await tx
      .insert(withdrawals)
      .values({
        id,
        userId,
        methodId: method.id,
        provider: provider.id,
        sandbox: provider.sandbox,
        amount: input.amount,
        fee,
        payout: input.amount - fee,
        currency: platformCurrency().code,
        status: review ? 'UNDER_REVIEW' : 'APPROVED',
        idempotencyKey,
        holdTxId: hold.id,
        requestedAt: now,
        updatedAt: now,
      })
      .returning();
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'payment.withdrawal_requested', resourceType: 'withdrawal', resourceId: id, after: { amount: input.amount, fee, method: method.id, review } });
    if (!review) await sendPayout(tx, row!, now);
    await notify(tx, userId, {
      kind: 'withdrawal',
      title: 'Withdrawal requested',
      body: review ? `${(input.amount / 100).toFixed(2)} ${row!.currency} is waiting for a review by our finance team.` : `${(input.amount / 100).toFixed(2)} ${row!.currency} is being paid out.`,
      link: '/wallet/withdrawals',
    });
    const [fresh] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id));
    return { withdrawal: withdrawalView(fresh!, method.name), replayed: false };
  });
}

/** The player cancels before the payout is sent: the amount returns to the wallet. */
export async function cancelWithdrawal(userId: string, id: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const wallet = await lockWalletAccount(tx, userId);
    const [w] = await tx.select().from(withdrawals).where(and(eq(withdrawals.id, id), eq(withdrawals.userId, userId))).for('update');
    if (!w) throw errors.notFound('Withdrawal');
    if (!['REQUESTED', 'PENDING', 'UNDER_REVIEW', 'APPROVED'].includes(w.status)) throw errors.conflict('This withdrawal can no longer be cancelled: the payout has been sent.');
    await release(tx, w, wallet.id, 'CANCELLED', 'Cancelled at your request.', now);
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'payment.withdrawal_cancelled', resourceType: 'withdrawal', resourceId: id });
    const [fresh] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id));
    return withdrawalView(fresh!);
  });
}

/**
 * Finance review: approve (sends the payout) or reject (returns the amount).
 * Audited. A reviewer can never decide their own withdrawal, and a withdrawal
 * of at least the dual-approval threshold needs two different approvers: the
 * first approval is recorded and the withdrawal stays under review until a
 * second, different staff member approves (or anyone authorised rejects).
 */
export async function reviewWithdrawal(ctx: AdminCtx, id: string, decision: 'approve' | 'reject', note: string, now = new Date()) {
  const [peek] = await getDb().select({ userId: withdrawals.userId }).from(withdrawals).where(eq(withdrawals.id, id));
  if (!peek) throw errors.notFound('Withdrawal');
  if (peek.userId === ctx.adminId) throw errors.forbidden('You cannot review your own withdrawal.');
  return withTransaction(async (tx) => {
    const wallet = await lockWalletAccount(tx, peek.userId);
    const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for('update');
    if (!w) throw errors.notFound('Withdrawal');
    if (!['UNDER_REVIEW', 'PENDING', 'REQUESTED'].includes(w.status)) throw errors.conflict(`This withdrawal is ${w.status.toLowerCase().replace('_', ' ')} and cannot be reviewed.`);
    if (w.firstApprovedBy === ctx.adminId) throw errors.forbidden('You already approved this withdrawal: a second, different staff member must decide it.');
    const settings = await getCashierSettings(tx);
    let step: 'rejected' | 'first_approval' | 'approved';
    if (decision === 'reject') {
      step = 'rejected';
      await release(tx, w, wallet.id, 'REJECTED', note, now, { reviewedBy: ctx.adminId, reviewedAt: now });
    } else if (w.amount >= settings.dualApprovalThreshold && !w.firstApprovedBy) {
      step = 'first_approval';
      await tx.update(withdrawals).set({ status: 'UNDER_REVIEW', firstApprovedBy: ctx.adminId, firstApprovedAt: now, updatedAt: now }).where(eq(withdrawals.id, id));
    } else {
      step = 'approved';
      await tx.update(withdrawals).set({ status: 'APPROVED', reviewedBy: ctx.adminId, reviewedAt: now, reviewNote: note, updatedAt: now }).where(eq(withdrawals.id, id));
      await sendPayout(tx, { ...w, status: 'APPROVED' }, now);
      await notify(tx, w.userId, { kind: 'withdrawal', title: 'Withdrawal approved', body: `${(w.amount / 100).toFixed(2)} ${w.currency} is being paid out.`, link: '/wallet/withdrawals' });
    }
    await recordAdminAction(tx, {
      ...ctx,
      action: `payment.withdrawal_${step}`,
      targetType: 'withdrawal',
      targetId: id,
      reason: note,
      before: { status: w.status, firstApprovedBy: w.firstApprovedBy },
      after: { step, amount: w.amount },
    });
    const [fresh] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id));
    return { step, withdrawal: withdrawalView(fresh!) };
  });
}

/** Applies a verified payout event (inside the webhook transaction). */
export async function applyPayoutEvent(tx: Tx, providerId: string, e: { type: string; reference: string; amount: number; currency: string; reason?: string }, now: Date): Promise<{ result: string; withdrawalId: string | null }> {
  const [peek] = await tx.select({ id: withdrawals.id, userId: withdrawals.userId }).from(withdrawals).where(and(eq(withdrawals.providerReference, e.reference), eq(withdrawals.provider, providerId)));
  if (!peek) return { result: 'ignored: unknown payout reference', withdrawalId: null };
  const wallet = await lockWalletAccount(tx, peek.userId);
  const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, peek.id)).for('update');
  if (!w) return { result: 'ignored: withdrawal vanished', withdrawalId: null };
  if (w.status !== 'PROCESSING') return { result: `ignored: withdrawal is ${w.status.toLowerCase()}`, withdrawalId: w.id };
  if (e.type === 'payout.completed') {
    if (e.amount !== w.payout || e.currency !== w.currency) return { result: 'needs review: payout amount or currency mismatch', withdrawalId: w.id };
    const ids = await systemAccountIds(tx);
    const posted = await postTransaction(tx, {
      type: 'WITHDRAWAL_PAID',
      idempotencyKey: `withdrawal:${w.id}:close`,
      userId: w.userId,
      description: w.sandbox ? 'Withdrawal paid out (sandbox — no real money)' : 'Withdrawal paid out',
      postings: [
        { accountId: ids.PENDING_WITHDRAWALS, amount: -w.amount },
        { accountId: ids.PAYMENT_CLEARING, amount: w.payout },
        { accountId: ids.PAYMENT_FEES, amount: w.fee },
      ],
      metadata: { withdrawalId: w.id, provider: providerId, reference: w.providerReference },
    });
    await tx.update(withdrawals).set({ status: 'COMPLETED', closeTxId: posted.id, completedAt: now, updatedAt: now }).where(eq(withdrawals.id, w.id));
    await audit(tx, { actorType: 'SYSTEM', action: 'payment.withdrawal_completed', resourceType: 'withdrawal', resourceId: w.id, after: { payout: w.payout } });
    await notify(tx, w.userId, { kind: 'withdrawal', title: 'Withdrawal paid', body: `${(w.payout / 100).toFixed(2)} ${w.currency} has been sent${w.sandbox ? ' (sandbox, no real money)' : ''}.`, link: '/wallet/withdrawals' });
    return { result: 'completed', withdrawalId: w.id };
  }
  if (e.type === 'payout.failed') {
    await release(tx, w, wallet.id, 'FAILED', e.reason ?? 'The payout could not be completed.', now);
    return { result: 'failed; amount returned', withdrawalId: w.id };
  }
  return { result: 'ignored: not a payout event', withdrawalId: w.id };
}

export async function listWithdrawals(userId: string, limit = 50) {
  const rows = await getDb()
    .select({ w: withdrawals, method: paymentMethods.name })
    .from(withdrawals)
    .innerJoin(paymentMethods, eq(paymentMethods.id, withdrawals.methodId))
    .where(eq(withdrawals.userId, userId))
    .orderBy(desc(withdrawals.requestedAt))
    .limit(Math.min(limit, 200));
  return rows.map((r) => withdrawalView(r.w, r.method));
}
