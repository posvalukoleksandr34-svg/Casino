/**
 * Back-office finance: withdrawal queue, deposits, the payment event log,
 * cashier rules and payment methods. Reading needs payments:read; deciding
 * withdrawals and resolving deposits needs payments:review; editing rules and
 * methods needs payments:configure. Every change is an audited admin action
 * with a reason. Staff can never change an amount, credit a wallet without a
 * provider settlement, or decide their own withdrawal.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction } from '../db/client';
import { cashierSettings, deposits, paymentEvents, paymentMethods, users, withdrawals, type DepositStatus, type WithdrawalStatus } from '../db/schema';
import { errors } from '../errors';
import { notify } from '../notifications/notifications';
import { getCashierSettings, paymentsMode, platformCurrency } from './config';
import { depositView } from './deposits';
import { withdrawalView } from './withdrawals';

const QUEUE: WithdrawalStatus[] = ['REQUESTED', 'PENDING', 'UNDER_REVIEW'];

export async function adminWithdrawals(opts: { view?: 'queue' | 'processing' | 'all'; limit?: number } = {}) {
  const view = opts.view ?? 'queue';
  const where: SQL | undefined =
    view === 'queue' ? inArray(withdrawals.status, QUEUE) : view === 'processing' ? inArray(withdrawals.status, ['APPROVED', 'PROCESSING']) : undefined;
  const rows = await getDb()
    .select({ w: withdrawals, method: paymentMethods.name, username: users.username, kyc: users.kycStatus, accountStatus: users.status })
    .from(withdrawals)
    .innerJoin(paymentMethods, eq(paymentMethods.id, withdrawals.methodId))
    .innerJoin(users, eq(users.id, withdrawals.userId))
    .where(where)
    .orderBy(view === 'all' ? desc(withdrawals.requestedAt) : withdrawals.requestedAt)
    .limit(Math.min(opts.limit ?? 100, 500));
  const settings = await getCashierSettings(getDb());
  return rows.map((r) => ({
    ...withdrawalView(r.w, r.method),
    userId: r.w.userId,
    username: r.username,
    kyc: r.kyc,
    accountStatus: r.accountStatus,
    firstApprovedBy: r.w.firstApprovedBy,
    reviewedBy: r.w.reviewedBy,
    needsTwoApprovals: r.w.amount >= settings.dualApprovalThreshold,
  }));
}

export async function adminDeposits(opts: { status?: DepositStatus; limit?: number } = {}) {
  const rows = await getDb()
    .select({ d: deposits, method: paymentMethods.name, username: users.username })
    .from(deposits)
    .innerJoin(paymentMethods, eq(paymentMethods.id, deposits.methodId))
    .innerJoin(users, eq(users.id, deposits.userId))
    .where(opts.status ? eq(deposits.status, opts.status) : undefined)
    .orderBy(desc(deposits.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
  return rows.map((r) => ({ ...depositView(r.d, r.method), userId: r.d.userId, username: r.username }));
}

export async function adminPaymentEvents(opts: { invalidOnly?: boolean; limit?: number } = {}) {
  const rows = await getDb()
    .select()
    .from(paymentEvents)
    .where(opts.invalidOnly ? eq(paymentEvents.signatureValid, false) : undefined)
    .orderBy(desc(paymentEvents.id))
    .limit(Math.min(opts.limit ?? 100, 500));
  return rows.map((e) => ({
    id: e.id,
    provider: e.provider,
    eventId: e.eventId,
    type: e.eventType,
    signatureValid: e.signatureValid,
    result: e.result,
    depositId: e.depositId,
    withdrawalId: e.withdrawalId,
    receivedAt: e.receivedAt.toISOString(),
  }));
}

/** Totals for the finance dashboard (all amounts in minor units of the platform currency). */
export async function financeSummary() {
  const db = getDb();
  const [dep] = await db
    .select({
      completed: sql<string>`coalesce(sum(${deposits.amount}) FILTER (WHERE ${deposits.status} = 'COMPLETED'), 0)::text`,
      fees: sql<string>`coalesce(sum(${deposits.fee}) FILTER (WHERE ${deposits.status} = 'COMPLETED'), 0)::text`,
      pending: sql<number>`count(*) FILTER (WHERE ${deposits.status} IN ('CREATED', 'PENDING', 'PROCESSING'))::int`,
      review: sql<number>`count(*) FILTER (WHERE ${deposits.status} = 'UNDER_REVIEW')::int`,
    })
    .from(deposits);
  const [wd] = await db
    .select({
      paid: sql<string>`coalesce(sum(${withdrawals.payout}) FILTER (WHERE ${withdrawals.status} = 'COMPLETED'), 0)::text`,
      fees: sql<string>`coalesce(sum(${withdrawals.fee}) FILTER (WHERE ${withdrawals.status} = 'COMPLETED'), 0)::text`,
      held: sql<string>`coalesce(sum(${withdrawals.amount}) FILTER (WHERE ${withdrawals.status} IN ('REQUESTED', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING')), 0)::text`,
      queue: sql<number>`count(*) FILTER (WHERE ${withdrawals.status} IN ('REQUESTED', 'PENDING', 'UNDER_REVIEW'))::int`,
      processing: sql<number>`count(*) FILTER (WHERE ${withdrawals.status} IN ('APPROVED', 'PROCESSING'))::int`,
    })
    .from(withdrawals);
  const [ev] = await db
    .select({ rejected: sql<number>`count(*) FILTER (WHERE NOT ${paymentEvents.signatureValid} AND ${paymentEvents.receivedAt} > now() - interval '24 hours')::int` })
    .from(paymentEvents);
  return {
    mode: paymentsMode(),
    currency: platformCurrency(),
    deposits: { completed: Number(dep?.completed ?? 0), fees: Number(dep?.fees ?? 0), pending: dep?.pending ?? 0, underReview: dep?.review ?? 0 },
    withdrawals: { paid: Number(wd?.paid ?? 0), fees: Number(wd?.fees ?? 0), held: Number(wd?.held ?? 0), queue: wd?.queue ?? 0, processing: wd?.processing ?? 0 },
    rejectedWebhooks24h: ev?.rejected ?? 0,
  };
}

/**
 * Closes a deposit under review (the provider reported another amount or
 * currency) as FAILED. Staff cannot credit it: the wallet is credited only by
 * a matching, verified settlement. The operator refunds the payment through
 * the provider; the reason is shown to the player.
 */
export async function failDepositUnderReview(ctx: AdminCtx, id: string, reason: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const [d] = await tx.select().from(deposits).where(eq(deposits.id, id)).for('update');
    if (!d) throw errors.notFound('Deposit');
    if (d.userId === ctx.adminId) throw errors.forbidden('You cannot resolve your own deposit.');
    if (d.status !== 'UNDER_REVIEW') throw errors.conflict('Only a deposit under review can be resolved here.');
    await tx.update(deposits).set({ status: 'FAILED', failureReason: reason, updatedAt: now }).where(eq(deposits.id, id));
    await recordAdminAction(tx, { ...ctx, action: 'payment.deposit_failed_after_review', targetType: 'deposit', targetId: id, reason, before: { status: d.status }, after: { status: 'FAILED' } });
    await notify(tx, d.userId, { kind: 'deposit', title: 'Deposit not credited', body: `Your deposit could not be matched to the payment we received. ${reason}`, link: '/wallet/deposits' });
    return { ok: true };
  });
}

const money = (max: number) => z.int().min(1).max(max);
export const cashierSettingsPatchSchema = z
  .object({
    dailyDepositLimit: money(1_000_000_000),
    monthlyDepositLimit: money(10_000_000_000),
    depositExpiryMinutes: z.int().min(5).max(1440),
    dailyWithdrawalLimit: money(1_000_000_000),
    monthlyWithdrawalLimit: money(10_000_000_000),
    withdrawalCooldownMinutes: z.int().min(0).max(10_080),
    reviewThreshold: z.int().min(0).max(1_000_000_000),
    dualApprovalThreshold: money(10_000_000_000),
    kycRequiredForWithdrawal: z.boolean(),
    closedLoop: z.boolean(),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

export async function updateCashierSettings(ctx: AdminCtx, patch: z.infer<typeof cashierSettingsPatchSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const before = await getCashierSettings(tx);
    const next = { ...before, ...patch };
    if (next.monthlyDepositLimit < next.dailyDepositLimit) throw errors.validation('The monthly deposit limit cannot be below the daily one.');
    if (next.monthlyWithdrawalLimit < next.dailyWithdrawalLimit) throw errors.validation('The monthly withdrawal limit cannot be below the daily one.');
    await tx.update(cashierSettings).set({ ...patch, updatedAt: new Date(), updatedBy: ctx.adminId }).where(eq(cashierSettings.id, 1));
    const changed = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]));
    await recordAdminAction(tx, { ...ctx, action: 'payment.settings_updated', targetType: 'platform', targetId: 'cashier', reason, before: changed, after: patch });
    return getCashierSettings(tx);
  });
}

export const methodPatchSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    active: z.boolean(),
    depositEnabled: z.boolean(),
    withdrawalEnabled: z.boolean(),
    minDeposit: money(100_000_000),
    maxDeposit: money(1_000_000_000),
    minWithdrawal: money(100_000_000),
    maxWithdrawal: money(1_000_000_000),
    depositFeeFixed: z.int().min(0).max(100_000),
    depositFeeBp: z.int().min(0).max(1_000),
    withdrawalFeeFixed: z.int().min(0).max(100_000),
    withdrawalFeeBp: z.int().min(0).max(1_000),
    processingTime: z.string().trim().min(2).max(60),
    sortOrder: z.int().min(0).max(1000),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

export async function listMethods() {
  return getDb().select().from(paymentMethods).orderBy(paymentMethods.sortOrder);
}

/** Edits a payment method's limits, fees and availability. The provider and kind are fixed in code. */
export async function updateMethod(ctx: AdminCtx, id: string, patch: z.infer<typeof methodPatchSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const [before] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, id)).for('update');
    if (!before) throw errors.notFound('Payment method');
    const next = { ...before, ...patch };
    if (next.minDeposit > next.maxDeposit) throw errors.validation('The minimum deposit cannot exceed the maximum.');
    if (next.minWithdrawal > next.maxWithdrawal) throw errors.validation('The minimum withdrawal cannot exceed the maximum.');
    await tx.update(paymentMethods).set({ ...patch, updatedAt: new Date() }).where(eq(paymentMethods.id, id));
    const changed = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof typeof before]]));
    await recordAdminAction(tx, { ...ctx, action: 'payment.method_updated', targetType: 'payment_method', targetId: id, reason, before: changed, after: patch });
    const [row] = await tx.select().from(paymentMethods).where(and(eq(paymentMethods.id, id)));
    return row!;
  });
}
