/** Work waiting for staff and cashier totals, for the dashboard (from the database, never estimated). */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { deposits, playerRewards, riskFlags, supportTickets, tournaments, users, withdrawals } from '../db/schema';
import { financeSummary } from '../payments/admin';

export async function operationsSnapshot() {
  const db = getDb();
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const [finance, kycQueue, openFlags, openTickets, priorityTickets, depositsReview, rewardsOpen, rewardsClaimed, liveTournaments] = await Promise.all([
    financeSummary(),
    count(db.select({ n }).from(users).where(inArray(users.kycStatus, ['PENDING', 'UNDER_REVIEW']))),
    count(db.select({ n }).from(riskFlags).where(isNull(riskFlags.resolvedAt))),
    count(db.select({ n }).from(supportTickets).where(inArray(supportTickets.status, ['OPEN', 'IN_PROGRESS']))),
    count(db.select({ n }).from(supportTickets).where(and(inArray(supportTickets.status, ['OPEN', 'IN_PROGRESS']), eq(supportTickets.priority, 'HIGH')))),
    count(db.select({ n }).from(deposits).where(eq(deposits.status, 'UNDER_REVIEW'))),
    count(db.select({ n }).from(playerRewards).where(eq(playerRewards.status, 'AVAILABLE'))),
    db.select({ n, total: sql<string>`coalesce(sum(${playerRewards.amount}), 0)::text` }).from(playerRewards).where(eq(playerRewards.status, 'CLAIMED')),
    count(db.select({ n }).from(tournaments).where(and(eq(tournaments.status, 'SCHEDULED'), sql`${tournaments.startsAt} <= now() AND ${tournaments.endsAt} > now()`))),
  ]);
  const [deps] = await db
    .select({ status: deposits.status, n })
    .from(deposits)
    .groupBy(deposits.status)
    .then((rows) => [Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>]);
  const [wds] = await db
    .select({ status: withdrawals.status, n })
    .from(withdrawals)
    .groupBy(withdrawals.status)
    .then((rows) => [Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>]);
  return {
    finance,
    depositsByStatus: deps ?? {},
    withdrawalsByStatus: wds ?? {},
    kycQueue,
    openFlags,
    openTickets,
    priorityTickets,
    depositsReview,
    rewards: { available: rewardsOpen, claimed: rewardsClaimed[0]?.n ?? 0, claimedTotal: Number(rewardsClaimed[0]?.total ?? 0) },
    liveTournaments,
  };
}
