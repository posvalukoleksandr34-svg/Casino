/**
 * Promotional campaigns: welcome offers and promo codes, with wagering
 * requirements, on the double-entry ledger (migration 0012).
 *
 * Virtual credits only: nothing here can be bought, withdrawn or exchanged.
 *
 *   claim     PROMOTIONS −amount → BONUS_LOCKED +amount   (BONUS_CLAIMED)
 *   release   BONUS_LOCKED −amount → player wallet +amount (BONUS_RELEASED),
 *             once the settled stakes since the claim reach the requirement
 *   forfeit / expiry
 *             BONUS_LOCKED −amount → PROMOTIONS +amount   (BONUS_FORFEITED)
 *
 * The player keeps one wallet: locked credits cannot be wagered. A campaign
 * can be claimed once per player (UNIQUE), and a player has at most one
 * active bonus (partial unique index), so wagering is attributed without
 * ambiguity. Lock order is the platform's: the player's wallet first.
 */
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { mulDivFloor } from '@/engine/money';
import { audit } from '../audit/audit';
import { getDb, withTransaction, type Executor, type Tx } from '../db/client';
import { bonusCampaigns, bonusClaims, bonuses, users, type BonusClaimStatus } from '../db/schema';
import { errors } from '../errors';
import { lockWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { getLimits } from '../responsible/limits';

export type Campaign = typeof bonusCampaigns.$inferSelect;
export type Claim = typeof bonusClaims.$inferSelect;

const DAY = 86_400_000;

/** The welcome offer seeded at bootstrap (admins can change or end it). */
export const DEFAULT_WELCOME_CAMPAIGN = {
  slug: 'welcome',
  kind: 'WELCOME' as const,
  name: 'Welcome bonus',
  description: '100% of your starting credits as bonus credits, up to 20,000. They move to your wallet once you have wagered the bonus amount once.',
  matchPercent: 100,
  fixedAmount: 0,
  maxBonus: 2_000_000,
  wageringMultiplier: 1,
  expiresAfterDays: 30,
  eligibleAccountAgeDays: 30,
};

export async function ensureDefaultCampaigns(db: Executor): Promise<void> {
  await db.insert(bonusCampaigns).values(DEFAULT_WELCOME_CAMPAIGN).onConflictDoNothing({ target: bonusCampaigns.slug });
}

/** Credits the player received when the account was activated (the welcome match is based on it). */
async function startingCredits(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ amount: bonuses.amount })
    .from(bonuses)
    .where(and(eq(bonuses.userId, userId), eq(bonuses.type, 'SIGNUP')));
  return row?.amount ?? 0;
}

/** Bonus amount for a player: fixed + match % of starting credits, capped. */
export function bonusAmount(c: Pick<Campaign, 'fixedAmount' | 'matchPercent' | 'maxBonus'>, starting: number): number {
  return Math.min(c.maxBonus, c.fixedAmount + mulDivFloor(starting, c.matchPercent, 100));
}

/** Why a player cannot claim a campaign now (null = eligible). Read-only. */
async function ineligibility(db: Executor, userId: string, c: Campaign, now: Date): Promise<string | null> {
  if (!c.active) return 'This offer is no longer available.';
  if (c.startsAt > now) return 'This offer has not started yet.';
  if (c.endsAt && c.endsAt <= now) return 'This offer has ended.';
  const [user] = await db.select({ status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  if (!user || user.status !== 'ACTIVE') return 'This account cannot claim offers.';
  if (c.eligibleAccountAgeDays !== null && now.getTime() - user.createdAt.getTime() > c.eligibleAccountAgeDays * DAY) {
    return `This offer is for accounts up to ${c.eligibleAccountAgeDays} days old.`;
  }
  const [mine] = await db
    .select({ id: bonusClaims.id })
    .from(bonusClaims)
    .where(and(eq(bonusClaims.userId, userId), eq(bonusClaims.campaignId, c.id)));
  if (mine) return 'You have already claimed this offer.';
  if (c.maxClaims !== null) {
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(bonusClaims).where(eq(bonusClaims.campaignId, c.id));
    if ((n?.n ?? 0) >= c.maxClaims) return 'This offer has been fully claimed.';
  }
  const rg = await getLimits(db, userId, now);
  if (rg.selfExcludedUntil) return 'Offers are not available while your account is self-excluded.';
  if (rg.coolOffUntil) return 'Offers are not available during a cool-off break.';
  if (bonusAmount(c, await startingCredits(db, userId)) <= 0) return 'This offer has nothing to give on this account.';
  return null;
}

async function activeClaim(db: Executor, userId: string): Promise<Claim | undefined> {
  const [row] = await db.select().from(bonusClaims).where(and(eq(bonusClaims.userId, userId), eq(bonusClaims.status, 'ACTIVE')));
  return row;
}

async function lockActiveClaim(tx: Tx, userId: string): Promise<Claim | undefined> {
  const [row] = await tx
    .select()
    .from(bonusClaims)
    .where(and(eq(bonusClaims.userId, userId), eq(bonusClaims.status, 'ACTIVE')))
    .for('update');
  return row;
}

async function close(tx: Tx, claim: Claim, status: Exclude<BonusClaimStatus, 'ACTIVE'>, walletAccountId: number, now: Date): Promise<number> {
  const ids = await systemAccountIds(tx);
  const released = status === 'COMPLETED';
  const posted = await postTransaction(tx, {
    type: released ? 'BONUS_RELEASED' : 'BONUS_FORFEITED',
    idempotencyKey: `bonus-claim:${claim.id}:close`,
    userId: claim.userId,
    description: released ? 'Bonus credits released to your wallet' : status === 'EXPIRED' ? 'Bonus expired' : 'Bonus forfeited',
    postings: released
      ? [
          { accountId: ids.BONUS_LOCKED, amount: -claim.amount },
          { accountId: walletAccountId, amount: claim.amount },
        ]
      : [
          { accountId: ids.BONUS_LOCKED, amount: -claim.amount },
          { accountId: ids.PROMOTIONS, amount: claim.amount },
        ],
    metadata: { claimId: claim.id, campaignId: claim.campaignId },
  });
  await tx.update(bonusClaims).set({ status, closedAt: now, closeTxId: posted.id }).where(eq(bonusClaims.id, claim.id));
  await audit(tx, {
    actorId: status === 'FORFEITED' ? claim.userId : null,
    actorType: status === 'FORFEITED' ? 'USER' : 'SYSTEM',
    action: `bonus.${status.toLowerCase()}`,
    resourceType: 'bonus_claim',
    resourceId: String(claim.id),
    after: { amount: claim.amount, progress: claim.wageringProgress, required: claim.wageringRequired },
  });
  return posted.id;
}

/**
 * Claims a welcome offer (by campaign id) or a promo code. Exactly once per
 * campaign per player; never while another bonus is in progress.
 */
export async function claimBonus(userId: string, by: { campaignId: number } | { code: string }, now = new Date()) {
  return withTransaction(async (tx) => {
    const wallet = await lockWalletAccount(tx, userId);
    const where =
      'code' in by
        ? and(eq(bonusCampaigns.code, by.code.trim().toUpperCase()), eq(bonusCampaigns.kind, 'PROMO_CODE'))
        : and(eq(bonusCampaigns.id, by.campaignId), eq(bonusCampaigns.kind, 'WELCOME'));
    // Locking the campaign serialises claims against its claim cap.
    const [campaign] = await tx.select().from(bonusCampaigns).where(where).for('update');
    if (!campaign) throw 'code' in by ? errors.validation('That code is not valid.') : errors.notFound('Offer');
    const why = await ineligibility(tx, userId, campaign, now);
    if (why) throw errors.conflict(why);
    if (await lockActiveClaim(tx, userId)) throw errors.conflict('Finish or forfeit your current bonus before claiming another.');

    const amount = bonusAmount(campaign, await startingCredits(tx, userId));
    const ids = await systemAccountIds(tx);
    const posted = await postTransaction(tx, {
      type: 'BONUS_CLAIMED',
      idempotencyKey: `bonus-campaign:${campaign.id}:user:${userId}`,
      userId,
      description: `${campaign.name} (bonus credits, locked until wagered)`,
      postings: [
        { accountId: ids.PROMOTIONS, amount: -amount },
        { accountId: ids.BONUS_LOCKED, amount },
      ],
      metadata: { campaignId: campaign.id },
    });
    const required = amount * campaign.wageringMultiplier;
    const [claim] = await tx
      .insert(bonusClaims)
      .values({
        userId,
        campaignId: campaign.id,
        amount,
        wageringRequired: required,
        status: 'ACTIVE',
        expiresAt: new Date(now.getTime() + campaign.expiresAfterDays * DAY),
        claimedAt: now,
        grantTxId: posted.id,
      })
      .returning();
    await audit(tx, {
      actorId: userId,
      actorType: 'USER',
      action: 'bonus.claimed',
      resourceType: 'bonus_claim',
      resourceId: String(claim!.id),
      after: { campaign: campaign.slug, amount, required },
    });
    // No wagering requirement: the credits are released at once.
    if (required === 0) await close(tx, claim!, 'COMPLETED', wallet.id, now);
    return { claimId: claim!.id, amount, wageringRequired: required, released: required === 0 };
  });
}

/**
 * Counts a settled casino stake towards the player's active bonus, inside the
 * settlement transaction (the caller holds the player's wallet lock). Releases
 * the bonus when the requirement is met. Expired claims are left to the
 * expiry job and never progress.
 */
export async function recordWagering(tx: Tx, userId: string, walletAccountId: number, stake: number, now = new Date()): Promise<void> {
  if (stake <= 0) return;
  const claim = await lockActiveClaim(tx, userId);
  if (!claim || claim.expiresAt <= now) return;
  const progress = Math.min(claim.wageringRequired, claim.wageringProgress + stake);
  if (progress !== claim.wageringProgress) {
    await tx.update(bonusClaims).set({ wageringProgress: progress }).where(eq(bonusClaims.id, claim.id));
  }
  if (progress >= claim.wageringRequired) await close(tx, { ...claim, wageringProgress: progress }, 'COMPLETED', walletAccountId, now);
}

/** The player gives up their active bonus: the locked credits return to promotions. */
export async function forfeitBonus(userId: string, claimId: number, now = new Date()) {
  return withTransaction(async (tx) => {
    const wallet = await lockWalletAccount(tx, userId);
    const claim = await lockActiveClaim(tx, userId);
    if (!claim || claim.id !== claimId) throw errors.conflict('This bonus is not active.');
    await close(tx, claim, 'FORFEITED', wallet.id, now);
    return { claimId, status: 'FORFEITED' as const };
  });
}

/** Expires active claims past their deadline (scheduler). Returns how many were closed. */
export async function expireDueBonuses(now = new Date(), limit = 200): Promise<number> {
  const due = await getDb()
    .select({ id: bonusClaims.id, userId: bonusClaims.userId })
    .from(bonusClaims)
    .where(and(eq(bonusClaims.status, 'ACTIVE'), lte(bonusClaims.expiresAt, now)))
    .orderBy(asc(bonusClaims.expiresAt))
    .limit(limit);
  let n = 0;
  for (const d of due) {
    const closed = await withTransaction(async (tx) => {
      const wallet = await lockWalletAccount(tx, d.userId);
      const claim = await lockActiveClaim(tx, d.userId);
      if (!claim || claim.id !== d.id || claim.expiresAt > now) return false;
      await close(tx, claim, 'EXPIRED', wallet.id, now);
      return true;
    });
    if (closed) n += 1;
  }
  return n;
}

export interface ClaimView {
  id: number;
  campaign: string;
  amount: number;
  wageringRequired: number;
  wageringProgress: number;
  status: BonusClaimStatus;
  expiresAt: string;
  claimedAt: string;
  closedAt: string | null;
}

export interface OfferView {
  id: number;
  name: string;
  description: string;
  amount: number;
  wageringMultiplier: number;
  expiresAfterDays: number;
  endsAt: string | null;
  eligible: boolean;
  reason: string | null;
}

const claimView = (c: Claim, name: string): ClaimView => ({
  id: c.id,
  campaign: name,
  amount: c.amount,
  wageringRequired: c.wageringRequired,
  wageringProgress: c.wageringProgress,
  status: c.status,
  expiresAt: c.expiresAt.toISOString(),
  claimedAt: c.claimedAt.toISOString(),
  closedAt: c.closedAt?.toISOString() ?? null,
});

/** Everything the bonus dashboard shows: welcome offers, the active bonus, claim history, simple grants. */
export async function bonusOverview(userId: string, now = new Date()) {
  const db = getDb();
  const starting = await startingCredits(db, userId);
  const welcome = await db
    .select()
    .from(bonusCampaigns)
    .where(and(eq(bonusCampaigns.kind, 'WELCOME'), eq(bonusCampaigns.active, true), lte(bonusCampaigns.startsAt, now), or(isNull(bonusCampaigns.endsAt), gt(bonusCampaigns.endsAt, now))))
    .orderBy(asc(bonusCampaigns.id));
  const offers: OfferView[] = [];
  for (const c of welcome) {
    const reason = await ineligibility(db, userId, c, now);
    // Already-claimed offers appear in the history instead.
    if (reason === 'You have already claimed this offer.') continue;
    offers.push({
      id: c.id,
      name: c.name,
      description: c.description,
      amount: bonusAmount(c, starting),
      wageringMultiplier: c.wageringMultiplier,
      expiresAfterDays: c.expiresAfterDays,
      endsAt: c.endsAt?.toISOString() ?? null,
      eligible: reason === null,
      reason,
    });
  }
  const claims = await db
    .select({ claim: bonusClaims, name: bonusCampaigns.name })
    .from(bonusClaims)
    .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusClaims.campaignId))
    .where(eq(bonusClaims.userId, userId))
    .orderBy(desc(bonusClaims.claimedAt))
    .limit(50);
  const grants = await db
    .select({ type: bonuses.type, amount: bonuses.amount, createdAt: bonuses.createdAt })
    .from(bonuses)
    .where(eq(bonuses.userId, userId))
    .orderBy(desc(bonuses.createdAt))
    .limit(30);
  const active = claims.find((c) => c.claim.status === 'ACTIVE');
  return {
    offers,
    active: active ? claimView(active.claim, active.name) : null,
    claims: claims.map((c) => claimView(c.claim, c.name)),
    grants: grants.map((g) => ({ type: g.type, amount: g.amount, createdAt: g.createdAt.toISOString() })),
  };
}

/** Locked bonus credits for the wallet overview. */
export async function lockedBonus(db: Executor, userId: string): Promise<number> {
  return (await activeClaim(db, userId))?.amount ?? 0;
}
