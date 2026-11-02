/**
 * Player rewards: weekly VIP cashback, a birthday reward, VIP level-up rewards
 * and tournament prizes. A reward is created by the server (never by the
 * client), shown to the player with its reason and expiry, and becomes
 * spendable only when the player claims it: one REWARD_CREDITED transaction
 * (promotions → wallet), posted once (unique ledger link and idempotency key)
 * and checked by reconciliation (rewards_match_ledger). Rewards are wager-free.
 *
 * Player protection: rewards are not created for, and cannot be claimed by,
 * accounts that are suspended, self-excluded or on a cool-off break.
 */
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit, recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction, type Executor, type Tx } from '../db/client';
import { playerRewards, rewardSettings, users, type RewardKind } from '../db/schema';
import { errors } from '../errors';
import { lockWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { notify } from '../notifications/notifications';
import { getLimits } from '../responsible/limits';

const DAY = 86_400_000;

export const DEFAULT_REWARD_SETTINGS = { id: 1, birthdayAmount: 50_000, cashbackMinLoss: 10_000, cashbackMax: 1_000_000, rewardExpiryDays: 14 };

export async function ensureRewardSettings(db: Executor): Promise<void> {
  await db.insert(rewardSettings).values(DEFAULT_REWARD_SETTINGS).onConflictDoNothing({ target: rewardSettings.id });
}

export async function getRewardSettings(db: Executor) {
  const [row] = await db.select().from(rewardSettings).where(eq(rewardSettings.id, 1));
  if (!row) throw new Error('reward settings missing; run migrations and bootstrap');
  return row;
}

export const KIND_LABELS: Record<RewardKind, string> = { CASHBACK: 'Weekly cashback', BIRTHDAY: 'Birthday reward', LEVEL_UP: 'VIP level-up reward', TOURNAMENT: 'Tournament prize' };

/** Why an account may not receive or claim rewards right now (null = it may). */
export async function rewardBlocker(db: Executor, userId: string, now = new Date()): Promise<string | null> {
  const [u] = await db.select({ status: users.status, role: users.role }).from(users).where(eq(users.id, userId));
  if (!u || u.status !== 'ACTIVE') return 'Rewards are not available on this account.';
  const rg = await getLimits(db, userId, now);
  if (rg.selfExcludedUntil) return 'Rewards are not available while your account is self-excluded.';
  if (rg.coolOffUntil) return 'Rewards are not available during a cool-off break.';
  return null;
}

/**
 * Creates a reward once per (player, kind, period). Returns the new reward id,
 * or null if it already existed or the account may not receive rewards.
 */
export async function grantReward(
  db: Executor,
  input: { userId: string; kind: RewardKind; periodKey: string; amount: number; description: string; now?: Date },
): Promise<number | null> {
  const now = input.now ?? new Date();
  if (input.amount <= 0) return null;
  if (await rewardBlocker(db, input.userId, now)) return null;
  const settings = await getRewardSettings(db);
  const [row] = await db
    .insert(playerRewards)
    .values({
      userId: input.userId,
      kind: input.kind,
      periodKey: input.periodKey,
      amount: Math.min(input.amount, 10_000_000),
      description: input.description.slice(0, 200),
      createdAt: now,
      expiresAt: new Date(now.getTime() + settings.rewardExpiryDays * DAY),
    })
    .onConflictDoNothing()
    .returning({ id: playerRewards.id });
  if (!row) return null;
  await notify(db, input.userId, {
    kind: input.kind === 'LEVEL_UP' ? 'vip' : 'bonus',
    title: `${KIND_LABELS[input.kind]} ready`,
    body: `${(input.amount / 100).toFixed(2)} credits are waiting for you: ${input.description} Claim it by ${new Date(now.getTime() + settings.rewardExpiryDays * DAY).toISOString().slice(0, 10)}.`,
    link: '/rewards',
  });
  return row.id;
}

export async function listRewards(userId: string, now = new Date()) {
  const rows = await getDb().select().from(playerRewards).where(eq(playerRewards.userId, userId)).orderBy(desc(playerRewards.createdAt)).limit(100);
  return {
    blocker: await rewardBlocker(getDb(), userId, now),
    rewards: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      kindLabel: KIND_LABELS[r.kind],
      amount: r.amount,
      description: r.description,
      status: r.status === 'AVAILABLE' && r.expiresAt <= now ? ('EXPIRED' as const) : r.status,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      claimedAt: r.claimedAt?.toISOString() ?? null,
    })),
  };
}

/** Claims an available reward: credits the wallet once. */
export async function claimReward(userId: string, rewardId: number, now = new Date()) {
  return withTransaction(async (tx) => {
    const wallet = await lockWalletAccount(tx, userId);
    const [r] = await tx.select().from(playerRewards).where(and(eq(playerRewards.id, rewardId), eq(playerRewards.userId, userId))).for('update');
    if (!r) throw errors.notFound('Reward');
    if (r.status === 'CLAIMED') throw errors.conflict('This reward has already been claimed.');
    if (r.status === 'EXPIRED' || r.expiresAt <= now) throw errors.conflict('This reward has expired.');
    const blocker = await rewardBlocker(tx, userId, now);
    if (blocker) throw errors.conflict(blocker);
    const posted = await credit(tx, r, wallet.id);
    await tx.update(playerRewards).set({ status: 'CLAIMED', claimedAt: now, ledgerTxId: posted.id }).where(eq(playerRewards.id, r.id));
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'reward.claimed', resourceType: 'player_reward', resourceId: String(r.id), after: { kind: r.kind, amount: r.amount } });
    const entry = posted.entries.find((e) => e.accountId === wallet.id);
    return { rewardId: r.id, amount: r.amount, balance: entry?.balanceAfter ?? wallet.balance + r.amount };
  });
}

async function credit(tx: Tx, r: typeof playerRewards.$inferSelect, walletAccountId: number) {
  const ids = await systemAccountIds(tx);
  return postTransaction(tx, {
    type: 'REWARD_CREDITED',
    idempotencyKey: `reward:${r.id}`,
    userId: r.userId,
    description: `${KIND_LABELS[r.kind]}: ${r.description}`.slice(0, 200),
    postings: [
      { accountId: ids.PROMOTIONS, amount: -r.amount },
      { accountId: walletAccountId, amount: r.amount },
    ],
    metadata: { rewardId: r.id, kind: r.kind, period: r.periodKey },
  });
}

/** Rewards past their deadline expire unclaimed (scheduler). */
export async function expireRewards(now = new Date()): Promise<number> {
  const res = await getDb()
    .update(playerRewards)
    .set({ status: 'EXPIRED' })
    .where(and(eq(playerRewards.status, 'AVAILABLE'), lte(playerRewards.expiresAt, now)))
    .returning({ id: playerRewards.id });
  return res.length;
}

/** ISO week key (e.g. 2026-W44) and the UTC bounds of the week before `now`. */
export function previousIsoWeek(now: Date): { key: string; start: Date; end: Date } {
  const day = (now.getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const start = new Date(thisMonday.getTime() - 7 * DAY);
  // ISO week number of `start` (Thursday rule).
  const thursday = new Date(start.getTime() + 3 * DAY);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.floor((thursday.getTime() - yearStart.getTime()) / DAY / 7) + 1;
  return { key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, start, end: thisMonday };
}

/**
 * Weekly cashback (scheduler; idempotent per player and week): the tier's
 * percentage of last week's net casino losses (stakes minus payouts of settled
 * rounds), from the configured minimum loss, capped.
 */
export async function issueWeeklyCashback(now = new Date()): Promise<number> {
  const db = getDb();
  const settings = await getRewardSettings(db);
  const { key, start, end } = previousIsoWeek(now);
  const res = await db.execute<{ user_id: string; net_loss: string; bp: number }>(sql`
    SELECT r.user_id, (sum(r.stake_total) - sum(r.payout_total))::text AS net_loss, t.cashback_bp AS bp
    FROM game_rounds r
    JOIN users u ON u.id = r.user_id
    JOIN vip_tiers t ON t.level = u.vip_level
    WHERE r.status = 'SETTLED' AND r.settled_at >= ${start} AND r.settled_at < ${end} AND t.cashback_bp > 0 AND u.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM player_rewards p WHERE p.user_id = r.user_id AND p.kind = 'CASHBACK' AND p.period_key = ${key})
    GROUP BY r.user_id, t.cashback_bp
    HAVING sum(r.stake_total) - sum(r.payout_total) >= ${settings.cashbackMinLoss}`);
  let n = 0;
  for (const row of res.rows) {
    const amount = Math.min(settings.cashbackMax, Math.floor((Number(row.net_loss) * row.bp) / 10_000));
    const id = await grantReward(db, { userId: row.user_id, kind: 'CASHBACK', periodKey: key, amount, description: `${(row.bp / 100).toFixed(2)}% of your net casino losses in ${key}.`, now });
    if (id) n++;
  }
  return n;
}

/** Birthday rewards (scheduler; once per player per year; 29 February counts on 28 February in other years). */
export async function issueBirthdayRewards(now = new Date()): Promise<number> {
  const db = getDb();
  const settings = await getRewardSettings(db);
  if (settings.birthdayAmount <= 0) return 0;
  const year = now.getUTCFullYear();
  const md = now.toISOString().slice(5, 10);
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  const days = md === '02-28' && !leap ? ['02-28', '02-29'] : [md];
  const res = await db.execute<{ id: string }>(sql`
    SELECT u.id FROM users u
    WHERE u.status = 'ACTIVE' AND u.role = 'PLAYER' AND u.date_of_birth IS NOT NULL
      AND to_char(u.date_of_birth, 'MM-DD') IN (${days[0]!}, ${days[1] ?? days[0]!})
      AND NOT EXISTS (SELECT 1 FROM player_rewards p WHERE p.user_id = u.id AND p.kind = 'BIRTHDAY' AND p.period_key = ${String(year)})`);
  let n = 0;
  for (const row of res.rows) {
    if (await grantReward(db, { userId: row.id, kind: 'BIRTHDAY', periodKey: String(year), amount: settings.birthdayAmount, description: 'Happy birthday from Aurovane.', now })) n++;
  }
  return n;
}

export async function runRewardJobs(now = new Date()) {
  return { expired: await expireRewards(now), cashback: await issueWeeklyCashback(now), birthday: await issueBirthdayRewards(now) };
}

export const rewardSettingsPatchSchema = z
  .object({
    birthdayAmount: z.int().min(0).max(10_000_000),
    cashbackMinLoss: z.int().min(0).max(1_000_000_000),
    cashbackMax: z.int().min(1).max(10_000_000),
    rewardExpiryDays: z.int().min(1).max(90),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

export async function updateRewardSettings(ctx: AdminCtx, patch: z.infer<typeof rewardSettingsPatchSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const before = await getRewardSettings(tx);
    await tx.update(rewardSettings).set({ ...patch, updatedAt: new Date(), updatedBy: ctx.adminId }).where(eq(rewardSettings.id, 1));
    await recordAdminAction(tx, { ...ctx, action: 'reward.settings_updated', targetType: 'platform', targetId: 'rewards', reason, before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof typeof before]])), after: patch });
    return getRewardSettings(tx);
  });
}
