/**
 * Deposits. A deposit is a request to a payment provider; the wallet is
 * credited only when the provider's signed settlement event arrives
 * (webhooks.ts) — never because a browser says the payment succeeded.
 *
 *   CREATED → PENDING (player sent to the provider) → COMPLETED | FAILED | CANCELLED | EXPIRED
 *   UNDER_REVIEW: the provider reported something inconsistent (e.g. another
 *   amount); staff resolve it.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { audit } from '../audit/audit';
import { getDb, withTransaction, type Executor, type Tx } from '../db/client';
import { bonusCampaigns, bonusClaims, deposits, paymentMethods, users, type DepositStatus } from '../db/schema';
import { errors } from '../errors';
import { lockWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { bonusAmount, grantClaim, type Campaign } from '../promotions/campaigns';
import { getLimits } from '../responsible/limits';
import { notify } from '../notifications/notifications';
import { assertPaymentsEnabled, feeFor, getCashierSettings, paymentsMode, platformCurrency } from './config';
import { getProvider } from './providers';

const DAY = 86_400_000;
/** Statuses that count against deposit limits (money requested or received). */
const COUNTED: DepositStatus[] = ['CREATED', 'PENDING', 'PROCESSING', 'UNDER_REVIEW', 'COMPLETED'];

export type DepositRow = typeof deposits.$inferSelect;

export function depositView(d: DepositRow, methodName?: string) {
  return {
    id: d.id,
    method: methodName ?? d.methodId,
    methodId: d.methodId,
    sandbox: d.sandbox,
    amount: d.amount,
    fee: d.fee,
    credited: d.credited,
    currency: d.currency,
    status: d.status,
    reference: d.providerReference,
    failureReason: d.failureReason,
    createdAt: d.createdAt.toISOString(),
    completedAt: d.completedAt?.toISOString() ?? null,
    expiresAt: d.expiresAt.toISOString(),
  };
}

async function depositedSince(db: Executor, userId: string, since: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`coalesce(sum(${deposits.amount}), 0)::text` })
    .from(deposits)
    .where(and(eq(deposits.userId, userId), inArray(deposits.status, COUNTED), gt(deposits.createdAt, since)));
  return Number(r?.n ?? 0);
}

async function completedDeposits(db: Executor, userId: string, excludeId?: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deposits)
    .where(and(eq(deposits.userId, userId), eq(deposits.status, 'COMPLETED'), excludeId ? ne(deposits.id, excludeId) : undefined));
  return r?.n ?? 0;
}

/** Deposits requested or received in the last 24 hours and 30 days (what the deposit limits count). */
export async function depositTotals(db: Executor, userId: string, now = new Date()) {
  return { deposited24h: await depositedSince(db, userId, new Date(now.getTime() - DAY)), deposited30d: await depositedSince(db, userId, new Date(now.getTime() - 30 * DAY)) };
}

/** Why a player cannot deposit at all right now (null = allowed). */
async function depositBlocker(db: Executor, userId: string, now: Date): Promise<string | null> {
  if (paymentsMode() === 'disabled') return 'Payments are not available on this site.';
  const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
  if (u?.status !== 'ACTIVE') return 'This account cannot make deposits.';
  const rg = await getLimits(db, userId, now);
  if (rg.selfExcludedUntil) return 'Deposits are blocked while your account is self-excluded.';
  if (rg.coolOffUntil) return 'Deposits are blocked during your cool-off break.';
  return null;
}

/** Remaining deposit allowance: the stricter of the platform's and the player's own limits. */
async function depositAllowance(db: Executor, userId: string, now: Date) {
  const settings = await getCashierSettings(db);
  const rg = await getLimits(db, userId, now);
  const day = await depositedSince(db, userId, new Date(now.getTime() - DAY));
  const month = await depositedSince(db, userId, new Date(now.getTime() - 30 * DAY));
  const dailyLimit = Math.min(settings.dailyDepositLimit, rg.limits.dailyDepositLimit ?? Number.MAX_SAFE_INTEGER);
  const monthlyLimit = Math.min(settings.monthlyDepositLimit, rg.limits.monthlyDepositLimit ?? Number.MAX_SAFE_INTEGER);
  return {
    dailyLimit,
    monthlyLimit,
    usedDay: day,
    usedMonth: month,
    remaining: Math.max(0, Math.min(dailyLimit - day, monthlyLimit - month)),
    playerDailyLimit: rg.limits.dailyDepositLimit,
    playerMonthlyLimit: rg.limits.monthlyDepositLimit,
  };
}

/**
 * Deposit bonuses the player could take with their next deposit (and why not,
 * when not). `settling` is the deposit being settled right now: it is the
 * qualifying deposit, so it does not count as an earlier one.
 */
export async function depositBonusOffers(db: Executor, userId: string, now: Date, settling?: string) {
  const next = (await completedDeposits(db, userId, settling)) + 1;
  const rows = await db
    .select()
    .from(bonusCampaigns)
    .where(and(eq(bonusCampaigns.kind, 'DEPOSIT'), eq(bonusCampaigns.active, true), lte(bonusCampaigns.startsAt, now), or(isNull(bonusCampaigns.endsAt), gt(bonusCampaigns.endsAt, now))))
    .orderBy(asc(bonusCampaigns.depositNumber), asc(bonusCampaigns.id));
  const claimed = new Set(
    (await db.select({ c: bonusClaims.campaignId }).from(bonusClaims).where(eq(bonusClaims.userId, userId))).map((r) => r.c),
  );
  const [active] = await db.select({ id: bonusClaims.id }).from(bonusClaims).where(and(eq(bonusClaims.userId, userId), eq(bonusClaims.status, 'ACTIVE')));
  const rg = await getLimits(db, userId, now);
  return rows
    .filter((c) => c.depositNumber === null || c.depositNumber === next)
    .filter((c) => !claimed.has(c.id))
    .map((c) => ({
      campaign: c,
      reason: active
        ? 'Finish or forfeit your current bonus first.'
        : rg.selfExcludedUntil || rg.coolOffUntil
          ? 'Bonuses are not offered during a break from play.'
          : null,
    }));
}

/** Everything the deposit form needs, computed on the server. */
export async function depositOptions(userId: string, now = new Date()) {
  const db = getDb();
  const methods = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.active, true), eq(paymentMethods.depositEnabled, true)))
    .orderBy(asc(paymentMethods.sortOrder));
  const offers = await depositBonusOffers(db, userId, now);
  return {
    mode: paymentsMode(),
    currency: platformCurrency(),
    blocker: await depositBlocker(db, userId, now),
    allowance: await depositAllowance(db, userId, now),
    methods: methods.map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      sandbox: m.sandbox,
      min: m.minDeposit,
      max: m.maxDeposit,
      feeFixed: m.depositFeeFixed,
      feeBp: m.depositFeeBp,
      processingTime: m.processingTime,
    })),
    bonuses: offers.map(({ campaign: c, reason }) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      depositNumber: c.depositNumber,
      matchPercent: c.matchPercent,
      fixedAmount: c.fixedAmount,
      maxBonus: c.maxBonus,
      minDeposit: c.minDeposit,
      wageringMultiplier: c.wageringMultiplier,
      maxBet: c.maxBet,
      expiresAfterDays: c.expiresAfterDays,
      available: reason === null,
      reason,
    })),
  };
}

export interface CreateDepositInput {
  methodId: string;
  amount: number;
  bonusCampaignId?: number | null;
}

/** Creates a deposit and starts it at the provider. Idempotent per player and key. */
export async function createDeposit(userId: string, input: CreateDepositInput, idempotencyKey: string, now = new Date()) {
  assertPaymentsEnabled();
  return withTransaction(async (tx) => {
    await lockWalletAccount(tx, userId);
    const [existing] = await tx.select().from(deposits).where(and(eq(deposits.userId, userId), eq(deposits.idempotencyKey, idempotencyKey)));
    if (existing) {
      if (existing.methodId !== input.methodId || existing.amount !== input.amount) throw errors.conflict('This request key was already used for another deposit.');
      return { deposit: depositView(existing), redirectUrl: null, replayed: true };
    }
    const blocker = await depositBlocker(tx, userId, now);
    if (blocker) throw errors.conflict(blocker);
    const [method] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, input.methodId));
    if (!method || !method.active || !method.depositEnabled) throw errors.validation('This payment method is not available.');
    if (input.amount < method.minDeposit || input.amount > method.maxDeposit) {
      throw errors.validation(`Deposits with ${method.name} must be between ${(method.minDeposit / 100).toFixed(2)} and ${(method.maxDeposit / 100).toFixed(2)}.`);
    }
    const allowance = await depositAllowance(tx, userId, now);
    if (input.amount > allowance.remaining) throw errors.responsible(`This deposit would exceed your deposit limit. You can deposit up to ${(allowance.remaining / 100).toFixed(2)} now.`);
    const fee = feeFor(input.amount, method.depositFeeFixed, method.depositFeeBp);
    if (fee >= input.amount) throw errors.validation('The amount does not cover the fee.');

    let bonusCampaignId: number | null = null;
    if (input.bonusCampaignId) {
      const offer = (await depositBonusOffers(tx, userId, now)).find((o) => o.campaign.id === input.bonusCampaignId);
      if (!offer) throw errors.conflict('That bonus is not available for this deposit.');
      if (offer.reason) throw errors.conflict(offer.reason);
      if (input.amount < offer.campaign.minDeposit) throw errors.validation(`That bonus needs a deposit of at least ${(offer.campaign.minDeposit / 100).toFixed(2)}.`);
      bonusCampaignId = offer.campaign.id;
    }

    const provider = getProvider(method.provider);
    if (!provider) throw errors.validation('This payment method is not available.');
    const id = randomUUID();
    const settings = await getCashierSettings(tx);
    const [row] = await tx
      .insert(deposits)
      .values({
        id,
        userId,
        methodId: method.id,
        provider: provider.id,
        sandbox: provider.sandbox,
        amount: input.amount,
        fee,
        credited: input.amount - fee,
        currency: platformCurrency().code,
        status: 'CREATED',
        idempotencyKey,
        bonusCampaignId,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + settings.depositExpiryMinutes * 60_000),
      })
      .returning();
    // A live provider call would happen outside the transaction with a retry-safe reference; the sandbox is local.
    const started = await provider.startDeposit({ id, amount: input.amount, currency: row!.currency, methodId: method.id });
    await tx.update(deposits).set({ status: 'PENDING', providerReference: started.reference, updatedAt: now }).where(eq(deposits.id, id));
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'payment.deposit_created', resourceType: 'deposit', resourceId: id, after: { amount: input.amount, fee, method: method.id, sandbox: provider.sandbox, bonusCampaignId } });
    return { deposit: depositView({ ...row!, status: 'PENDING', providerReference: started.reference }, method.name), redirectUrl: started.redirectUrl, replayed: false };
  });
}

/** The player abandons a deposit they have not paid. */
export async function cancelDeposit(userId: string, depositId: string, now = new Date()) {
  return withTransaction(async (tx) => {
    await lockWalletAccount(tx, userId);
    const [d] = await tx.select().from(deposits).where(and(eq(deposits.id, depositId), eq(deposits.userId, userId))).for('update');
    if (!d) throw errors.notFound('Deposit');
    if (!['CREATED', 'PENDING'].includes(d.status)) throw errors.conflict('This deposit can no longer be cancelled.');
    await tx.update(deposits).set({ status: 'CANCELLED', failureReason: 'Cancelled by the player', updatedAt: now }).where(eq(deposits.id, d.id));
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'payment.deposit_cancelled', resourceType: 'deposit', resourceId: d.id });
    return depositView({ ...d, status: 'CANCELLED' });
  });
}

/**
 * Applies a verified provider event to a deposit (inside the webhook
 * transaction). Credits the wallet exactly once, and grants an opted-in
 * deposit bonus if the player is still eligible. Returns the outcome text
 * recorded in the payment event log.
 */
export async function applyDepositEvent(tx: Tx, providerId: string, e: { type: string; reference: string; amount: number; currency: string; reason?: string }, now: Date): Promise<{ result: string; depositId: string | null }> {
  const [peek] = await tx.select({ id: deposits.id, userId: deposits.userId }).from(deposits).where(and(eq(deposits.providerReference, e.reference), eq(deposits.provider, providerId)));
  if (!peek) return { result: 'ignored: unknown deposit reference', depositId: null };
  const wallet = await lockWalletAccount(tx, peek.userId);
  const [d] = await tx.select().from(deposits).where(eq(deposits.id, peek.id)).for('update');
  if (!d) return { result: 'ignored: deposit vanished', depositId: null };
  const final = ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(d.status);

  if (e.type === 'deposit.completed') {
    if (d.status === 'COMPLETED') return { result: 'ignored: already completed', depositId: d.id };
    if (d.status === 'FAILED') {
      // The provider contradicts its own failure report: never credit silently; staff resolve it with the provider.
      await audit(tx, { actorType: 'SYSTEM', action: 'payment.contradictory_settlement', resourceType: 'deposit', resourceId: d.id, after: { status: d.status, amount: e.amount } });
      return { result: 'needs review: settlement for a failed deposit', depositId: d.id };
    }
    if (d.status === 'UNDER_REVIEW') return { result: 'ignored: deposit under review', depositId: d.id };
    if (e.amount !== d.amount || e.currency !== d.currency) {
      if (d.status === 'EXPIRED' || d.status === 'CANCELLED') {
        await audit(tx, { actorType: 'SYSTEM', action: 'payment.late_settlement_mismatch', resourceType: 'deposit', resourceId: d.id, after: { status: d.status, amount: e.amount, currency: e.currency } });
        return { result: `needs review: late settlement with another amount for a ${d.status.toLowerCase()} deposit`, depositId: d.id };
      }
      await tx.update(deposits).set({ status: 'UNDER_REVIEW', failureReason: `Provider reported ${e.amount} ${e.currency}`, updatedAt: now }).where(eq(deposits.id, d.id));
      return { result: 'under review: amount or currency mismatch', depositId: d.id };
    }
    if (d.status === 'EXPIRED' || d.status === 'CANCELLED') {
      // The money arrived after the deposit timed out or was abandoned here: it is the player's, so it is credited.
      await audit(tx, { actorType: 'SYSTEM', action: 'payment.late_settlement_credited', resourceType: 'deposit', resourceId: d.id, before: { status: d.status } });
    }
    const ids = await systemAccountIds(tx);
    const posted = await postTransaction(tx, {
      type: 'DEPOSIT',
      idempotencyKey: `deposit:${d.id}`,
      userId: d.userId,
      description: d.sandbox ? 'Deposit (sandbox — no real money)' : 'Deposit',
      postings: [
        { accountId: ids.PAYMENT_CLEARING, amount: -d.amount },
        { accountId: wallet.id, amount: d.credited },
        { accountId: ids.PAYMENT_FEES, amount: d.fee },
      ],
      metadata: { depositId: d.id, provider: providerId, reference: d.providerReference },
    });
    await tx.update(deposits).set({ status: 'COMPLETED', ledgerTxId: posted.id, completedAt: now, updatedAt: now }).where(eq(deposits.id, d.id));
    await audit(tx, { actorType: 'SYSTEM', action: 'payment.deposit_completed', resourceType: 'deposit', resourceId: d.id, after: { amount: d.amount, credited: d.credited } });
    await notify(tx, d.userId, { kind: 'deposit', title: 'Deposit received', body: `${(d.credited / 100).toFixed(2)} ${d.currency} added to your wallet${d.sandbox ? ' (sandbox, no real money)' : ''}.`, link: '/wallet/deposits' });
    let bonus = '';
    if (d.bonusCampaignId) bonus = await grantDepositBonus(tx, d, wallet.id, now);
    return { result: `completed${bonus}`, depositId: d.id };
  }

  if (e.type === 'deposit.failed' || e.type === 'deposit.cancelled') {
    if (final) return { result: `ignored: already ${d.status.toLowerCase()}`, depositId: d.id };
    const status = e.type === 'deposit.failed' ? 'FAILED' : 'CANCELLED';
    await tx.update(deposits).set({ status, failureReason: e.reason ?? (status === 'FAILED' ? 'The payment was declined' : 'The payment was cancelled'), updatedAt: now }).where(eq(deposits.id, d.id));
    await notify(tx, d.userId, { kind: 'deposit', title: status === 'FAILED' ? 'Deposit failed' : 'Deposit cancelled', body: e.reason ?? 'No money was taken.', link: '/wallet/deposits' });
    return { result: status.toLowerCase(), depositId: d.id };
  }
  return { result: 'ignored: not a deposit event', depositId: d.id };
}

/** Grants the deposit bonus the player opted into, if they are still eligible (re-checked now). */
async function grantDepositBonus(tx: Tx, d: DepositRow, walletAccountId: number, now: Date): Promise<string> {
  const offer = (await depositBonusOffers(tx, d.userId, now, d.id)).find((o) => o.campaign.id === d.bonusCampaignId);
  const campaign: Campaign | undefined = offer?.campaign;
  if (!campaign || offer?.reason || d.amount < campaign.minDeposit) {
    await notify(tx, d.userId, { kind: 'bonus', title: 'Deposit bonus not applied', body: offer?.reason ?? 'The bonus you chose was no longer available for this deposit.', link: '/promotions' });
    return '; bonus not applied';
  }
  // The deposit amount is the base for a deposit match.
  const amount = bonusAmount(campaign, d.amount);
  if (amount <= 0) return '; bonus amount 0';
  await grantClaim(tx, d.userId, campaign, amount, walletAccountId, now, d.id);
  await notify(tx, d.userId, { kind: 'bonus', title: `${campaign.name} activated`, body: `${(amount / 100).toFixed(2)} bonus credits, locked until you have wagered ${((amount * campaign.wageringMultiplier) / 100).toFixed(2)}.`, link: '/promotions' });
  return `; bonus ${amount}`;
}

/** Deposits not paid in time expire (no money moved). Scheduler job. */
export async function expireDeposits(now = new Date()): Promise<number> {
  const res = await getDb()
    .update(deposits)
    .set({ status: 'EXPIRED', failureReason: 'Not completed in time', updatedAt: now })
    .where(and(inArray(deposits.status, ['CREATED', 'PENDING', 'PROCESSING']), lte(deposits.expiresAt, now)))
    .returning({ id: deposits.id });
  return res.length;
}

export async function listDeposits(userId: string, limit = 50) {
  const rows = await getDb()
    .select({ d: deposits, method: paymentMethods.name })
    .from(deposits)
    .innerJoin(paymentMethods, eq(paymentMethods.id, deposits.methodId))
    .where(eq(deposits.userId, userId))
    .orderBy(desc(deposits.createdAt))
    .limit(Math.min(limit, 200));
  return rows.map((r) => depositView(r.d, r.method));
}

export async function getDeposit(userId: string, id: string) {
  const [r] = await getDb()
    .select({ d: deposits, method: paymentMethods.name })
    .from(deposits)
    .innerJoin(paymentMethods, eq(paymentMethods.id, deposits.methodId))
    .where(and(eq(deposits.id, id), eq(deposits.userId, userId)));
  if (!r) throw errors.notFound('Deposit');
  return depositView(r.d, r.method);
}
