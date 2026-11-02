/**
 * VIP tiers. A player's tier follows their lifetime casino wagering
 * (users.vip_wagered, added at each settlement in the same transaction). A
 * tier is never lost. Perks are real and enforced in code, nothing else is
 * promised:
 *   - a larger daily free top-up (top_up_bonus_pct, applied in promotions/bonuses.ts);
 *   - priority in the support queue (support/tickets.ts).
 * Thresholds, names and perks are edited in the back office (promotions:manage),
 * audited, and must keep increasing from tier to tier.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction, type Executor, type Tx } from '../db/client';
import { users, vipTiers } from '../db/schema';
import { errors } from '../errors';
import { notify } from '../notifications/notifications';

export type VipTier = typeof vipTiers.$inferSelect;

export const DEFAULT_VIP_TIERS = [
  { level: 1, name: 'Bronze', minWagered: 0, topUpBonusPct: 0, prioritySupport: false },
  { level: 2, name: 'Silver', minWagered: 5_000_000, topUpBonusPct: 25, prioritySupport: false },
  { level: 3, name: 'Gold', minWagered: 25_000_000, topUpBonusPct: 50, prioritySupport: true },
  { level: 4, name: 'Platinum', minWagered: 100_000_000, topUpBonusPct: 100, prioritySupport: true },
  { level: 5, name: 'Diamond', minWagered: 500_000_000, topUpBonusPct: 200, prioritySupport: true },
];

export async function ensureVipTiers(db: Executor): Promise<void> {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(vipTiers);
  if ((n?.n ?? 0) > 0) return;
  await db.insert(vipTiers).values(DEFAULT_VIP_TIERS).onConflictDoNothing();
}

export async function loadTiers(db: Executor): Promise<VipTier[]> {
  return db.select().from(vipTiers).orderBy(asc(vipTiers.level));
}

export async function tierFor(db: Executor, level: number): Promise<VipTier | undefined> {
  const [t] = await db.select().from(vipTiers).where(eq(vipTiers.level, level));
  return t;
}

export function levelForWagered(tiers: Pick<VipTier, 'level' | 'minWagered'>[], wagered: number): number {
  let level = 1;
  for (const t of tiers) if (wagered >= t.minWagered && t.level > level) level = t.level;
  return level;
}

/** Adds a settled stake to the player's VIP progress; announces a new tier. Same transaction as the settlement. */
export async function recordVipWagering(tx: Tx, userId: string, stake: number): Promise<void> {
  if (stake <= 0) return;
  const [u] = await tx
    .update(users)
    .set({ vipWagered: sql`${users.vipWagered} + ${stake}` })
    .where(eq(users.id, userId))
    .returning({ wagered: users.vipWagered, level: users.vipLevel });
  if (!u) return;
  const tiers = await loadTiers(tx);
  const level = levelForWagered(tiers, u.wagered);
  if (level <= u.level) return;
  await tx.update(users).set({ vipLevel: level }).where(eq(users.id, userId));
  const tier = tiers.find((t) => t.level === level)!;
  const perks = [tier.topUpBonusPct > 0 ? `a ${tier.topUpBonusPct}% larger daily free top-up` : null, tier.prioritySupport ? 'priority support' : null].filter(Boolean).join(' and ');
  await notify(tx, userId, { kind: 'vip', title: `Welcome to ${tier.name}`, body: perks ? `You reached the ${tier.name} tier: ${perks}.` : `You reached the ${tier.name} tier.`, link: '/vip' });
}

/** The player's tier, progress to the next one, and every tier's perks. */
export async function vipOverview(userId: string) {
  const db = getDb();
  const [u] = await db.select({ wagered: users.vipWagered, level: users.vipLevel }).from(users).where(eq(users.id, userId));
  const tiers = await loadTiers(db);
  const current = tiers.find((t) => t.level === (u?.level ?? 1)) ?? tiers[0];
  const next = tiers.find((t) => t.level > (u?.level ?? 1));
  return {
    wagered: u?.wagered ?? 0,
    current: current ? { level: current.level, name: current.name } : null,
    next: next ? { level: next.level, name: next.name, minWagered: next.minWagered, remaining: Math.max(0, next.minWagered - (u?.wagered ?? 0)) } : null,
    tiers: tiers.map((t) => ({ level: t.level, name: t.name, minWagered: t.minWagered, topUpBonusPct: t.topUpBonusPct, prioritySupport: t.prioritySupport })),
  };
}

/** Extra daily top-up percentage for a player's current tier. */
export async function topUpBonusPct(db: Executor, userId: string): Promise<number> {
  const [r] = await db
    .select({ pct: vipTiers.topUpBonusPct })
    .from(users)
    .innerJoin(vipTiers, eq(vipTiers.level, users.vipLevel))
    .where(eq(users.id, userId));
  return r?.pct ?? 0;
}

export const tierPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(30),
    minWagered: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    topUpBonusPct: z.int().min(0).max(500),
    prioritySupport: z.boolean(),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

export async function updateTier(ctx: AdminCtx, level: number, patch: z.infer<typeof tierPatchSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const tiers = await loadTiers(tx);
    const before = tiers.find((t) => t.level === level);
    if (!before) throw errors.notFound('Tier');
    const next = { ...before, ...patch };
    if (level === 1 && next.minWagered !== 0) throw errors.validation('The first tier starts at 0.');
    const prev = tiers.find((t) => t.level === level - 1);
    const after = tiers.find((t) => t.level === level + 1);
    if (prev && next.minWagered <= prev.minWagered) throw errors.validation(`The threshold must be above ${prev.name}'s.`);
    if (after && next.minWagered >= after.minWagered) throw errors.validation(`The threshold must be below ${after.name}'s.`);
    await tx.update(vipTiers).set({ ...patch, updatedAt: new Date() }).where(eq(vipTiers.level, level));
    await recordAdminAction(tx, { ...ctx, action: 'vip.tier_updated', targetType: 'vip_tier', targetId: String(level), reason, before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof VipTier]])), after: patch });
    // Tiers are never taken away; lowering a threshold promotes players at their next settlement.
    return (await loadTiers(tx)).find((t) => t.level === level)!;
  });
}
