/**
 * Tournaments. A player joins (eligibility checked on the server); from then
 * until the end of the window their settled rounds in the eligible games with
 * at least the minimum stake are scored from the authoritative round records.
 * Nothing the browser sends affects a score.
 *
 * Metrics rank luck, not volume, so a tournament never rewards playing more:
 *   BEST_MULTIPLIER   the best single-round payout multiple;
 *   TOP3_MULTIPLIERS  the sum of the player's three best multiples.
 * Ties go to whoever reached the score first.
 *
 * Standings show a player's display name only if they opted in to public
 * names (Settings); everyone else appears as "Anonymous player". There are no
 * invented entrants or winners: an empty tournament shows an empty table.
 *
 * When the window ends, the finalize job writes the results once (append-only
 * table) and creates each prize as a claimable reward (rewards/rewards.ts),
 * which is what moves credits — through the ledger. A cancelled tournament
 * pays nothing.
 */
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit, recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction, type Executor } from '../db/client';
import { games, tournamentEntries, tournamentResults, tournaments, users, vipTiers, type TournamentMetric } from '../db/schema';
import { errors } from '../errors';
import { notify } from '../notifications/notifications';
import { grantReward, rewardBlocker } from '../rewards/rewards';

export type Tournament = typeof tournaments.$inferSelect;
export const METRIC_LABELS: Record<TournamentMetric, string> = {
  BEST_MULTIPLIER: 'Best single-round multiplier',
  TOP3_MULTIPLIERS: 'Sum of your three best multipliers',
};

export function phase(t: Pick<Tournament, 'status' | 'startsAt' | 'endsAt'>, now = new Date()): 'UPCOMING' | 'RUNNING' | 'ENDED' | 'FINISHED' | 'CANCELLED' {
  if (t.status === 'CANCELLED') return 'CANCELLED';
  if (t.status === 'FINISHED') return 'FINISHED';
  if (now < t.startsAt) return 'UPCOMING';
  if (now < t.endsAt) return 'RUNNING';
  return 'ENDED';
}

export interface Standing {
  userId: string;
  name: string;
  score: number;
  reachedAt: string;
}

/** Live scores of a tournament's entrants, best first (from settled rounds only). */
export async function standings(db: Executor, t: Tournament, now = new Date()): Promise<Standing[]> {
  const until = t.endsAt < now ? t.endsAt : now;
  const gameFilter = t.gameIds.length ? sql`AND r.game_id IN (${sql.join(t.gameIds.map((g) => sql`${g}`), sql`, `)})` : sql``;
  const res = await db.execute<{ user_id: string; name: string; score: string; reached_at: Date }>(sql`
    WITH counted AS (
      SELECT r.user_id, (r.payout_total * 100 / r.stake_total) AS mult, r.settled_at,
             row_number() OVER (PARTITION BY r.user_id ORDER BY r.payout_total * 100 / r.stake_total DESC, r.settled_at) AS n
      FROM game_rounds r
      JOIN tournament_entries e ON e.user_id = r.user_id AND e.tournament_id = ${t.id}
      WHERE r.status = 'SETTLED' AND r.stake_total >= ${t.minStake}
        AND r.settled_at >= greatest(${t.startsAt}::timestamptz, e.joined_at) AND r.settled_at < ${until}
        ${gameFilter}
    )
    SELECT c.user_id,
           CASE WHEN (u.preferences->>'publicName')::boolean IS TRUE THEN coalesce(u.display_name, u.username) ELSE 'Anonymous player' END AS name,
           sum(c.mult)::text AS score, max(c.settled_at) AS reached_at
    FROM counted c JOIN users u ON u.id = c.user_id
    WHERE c.n <= ${t.metric === 'BEST_MULTIPLIER' ? 1 : 3}
    GROUP BY c.user_id, u.preferences, u.display_name, u.username
    HAVING sum(c.mult) > 0
    ORDER BY sum(c.mult) DESC, max(c.settled_at), c.user_id`);
  return res.rows.map((r) => ({ userId: r.user_id, name: r.name, score: Number(r.score), reachedAt: new Date(r.reached_at).toISOString() }));
}

function view(t: Tournament, now: Date) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    gameIds: t.gameIds,
    metric: t.metric,
    metricLabel: METRIC_LABELS[t.metric],
    minStake: t.minStake,
    minVipLevel: t.minVipLevel,
    startsAt: t.startsAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    prizes: t.prizes,
    prizePool: t.prizes.reduce((a, b) => a + b, 0),
    phase: phase(t, now),
  };
}

export async function listTournaments(now = new Date()) {
  const rows = await getDb().select().from(tournaments).orderBy(desc(tournaments.startsAt)).limit(100);
  const counts = rows.length
    ? await getDb()
        .select({ id: tournamentEntries.tournamentId, n: sql<number>`count(*)::int` })
        .from(tournamentEntries)
        .where(inArray(tournamentEntries.tournamentId, rows.map((r) => r.id)))
        .groupBy(tournamentEntries.tournamentId)
    : [];
  return rows.map((t) => ({ ...view(t, now), entrants: counts.find((c) => c.id === t.id)?.n ?? 0 }));
}

/** Why the player cannot join (null = they can). */
async function joinBlocker(db: Executor, t: Tournament, userId: string, now: Date): Promise<string | null> {
  const p = phase(t, now);
  if (p === 'CANCELLED') return 'This tournament was cancelled.';
  if (p === 'ENDED' || p === 'FINISHED') return 'This tournament has ended.';
  const [u] = await db.select({ role: users.role, vipLevel: users.vipLevel }).from(users).where(eq(users.id, userId));
  if (!u || u.role !== 'PLAYER') return 'Tournaments are for player accounts.';
  const blocker = await rewardBlocker(db, userId, now);
  if (blocker) return blocker.replace('Rewards are', 'Tournaments are');
  if (u.vipLevel < t.minVipLevel) {
    const [tier] = await db.select({ name: vipTiers.name }).from(vipTiers).where(eq(vipTiers.level, t.minVipLevel));
    return `This tournament is for ${tier?.name ?? `level ${t.minVipLevel}`} VIP members and above.`;
  }
  return null;
}

export async function tournamentDetail(slug: string, viewerId: string | null, now = new Date()) {
  const db = getDb();
  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug));
  if (!t) throw errors.notFound('Tournament');
  const [entrants] = await db.select({ n: sql<number>`count(*)::int` }).from(tournamentEntries).where(eq(tournamentEntries.tournamentId, t.id));
  const gameNames = t.gameIds.length ? await db.select({ id: games.id, name: games.name }).from(games).where(inArray(games.id, t.gameIds)) : [];
  let board: { rank: number; name: string; score: number; prize: number; you: boolean }[];
  if (t.status === 'FINISHED') {
    const rows = await db
      .select({ r: tournamentResults, preferences: users.preferences, displayName: users.displayName, username: users.username })
      .from(tournamentResults)
      .innerJoin(users, eq(users.id, tournamentResults.userId))
      .where(eq(tournamentResults.tournamentId, t.id))
      .orderBy(asc(tournamentResults.rank))
      .limit(100);
    board = rows.map(({ r, preferences, displayName, username }) => ({
      rank: r.rank,
      name: (preferences as { publicName?: boolean } | null)?.publicName ? (displayName ?? username) : 'Anonymous player',
      score: r.score,
      prize: r.prize,
      you: r.userId === viewerId,
    }));
  } else if (t.status === 'CANCELLED') {
    board = [];
  } else {
    const live = await standings(db, t, now);
    board = live.slice(0, 100).map((s, i) => ({ rank: i + 1, name: s.name, score: s.score, prize: t.prizes[i] ?? 0, you: s.userId === viewerId }));
    if (viewerId && !board.some((b) => b.you)) {
      const i = live.findIndex((s) => s.userId === viewerId);
      if (i >= 0) board.push({ rank: i + 1, name: live[i]!.name, score: live[i]!.score, prize: t.prizes[i] ?? 0, you: true });
    }
  }
  const joined = viewerId ? (await db.select().from(tournamentEntries).where(and(eq(tournamentEntries.tournamentId, t.id), eq(tournamentEntries.userId, viewerId))))[0] : undefined;
  return {
    tournament: { ...view(t, now), entrants: entrants?.n ?? 0, games: gameNames },
    board,
    me: viewerId ? { joined: Boolean(joined), joinedAt: joined?.joinedAt.toISOString() ?? null, blocker: joined ? null : await joinBlocker(db, t, viewerId, now) } : null,
  };
}

export async function joinTournament(userId: string, slug: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.slug, slug)).for('share');
    if (!t) throw errors.notFound('Tournament');
    const blocker = await joinBlocker(tx, t, userId, now);
    if (blocker) throw errors.conflict(blocker);
    const [row] = await tx.insert(tournamentEntries).values({ tournamentId: t.id, userId, joinedAt: now }).onConflictDoNothing().returning();
    if (!row) throw errors.conflict('You have already joined this tournament.');
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'tournament.joined', resourceType: 'tournament', resourceId: String(t.id) });
    return { joined: true, joinedAt: row.joinedAt.toISOString() };
  });
}

/** Tournaments a player joined, with their final rank and prize where finished. */
export async function myTournaments(userId: string) {
  const rows = await getDb()
    .select({ t: tournaments, joinedAt: tournamentEntries.joinedAt, rank: tournamentResults.rank, prize: tournamentResults.prize })
    .from(tournamentEntries)
    .innerJoin(tournaments, eq(tournaments.id, tournamentEntries.tournamentId))
    .leftJoin(tournamentResults, and(eq(tournamentResults.tournamentId, tournamentEntries.tournamentId), eq(tournamentResults.userId, tournamentEntries.userId)))
    .where(eq(tournamentEntries.userId, userId))
    .orderBy(desc(tournaments.endsAt))
    .limit(50);
  const now = new Date();
  return rows.map((r) => ({ slug: r.t.slug, name: r.t.name, phase: phase(r.t, now), endsAt: r.t.endsAt.toISOString(), joinedAt: r.joinedAt.toISOString(), rank: r.rank, prize: r.prize }));
}

/** Writes results and prizes of tournaments whose window has ended (scheduler; once per tournament). */
export async function finalizeTournaments(now = new Date()): Promise<number> {
  const due = await getDb().select({ id: tournaments.id }).from(tournaments).where(and(eq(tournaments.status, 'SCHEDULED'), lte(tournaments.endsAt, now)));
  let n = 0;
  for (const { id } of due) {
    const done = await withTransaction(async (tx) => {
      const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).for('update');
      if (!t || t.status !== 'SCHEDULED' || t.endsAt > now) return false;
      const final = await standings(tx, t, t.endsAt);
      for (const [i, s] of final.entries()) {
        const prize = t.prizes[i] ?? 0;
        let rewardId: number | null = null;
        if (prize > 0) {
          rewardId = await grantReward(tx, { userId: s.userId, kind: 'TOURNAMENT', periodKey: `tournament-${t.id}`, amount: prize, description: `Place ${i + 1} in ${t.name}.`, now });
        }
        // A prize the account may not receive now (e.g. self-excluded) is recorded as 0.
        await tx.insert(tournamentResults).values({ tournamentId: t.id, userId: s.userId, rank: i + 1, score: s.score, prize: rewardId ? prize : 0, rewardId });
        if (!rewardId) await notify(tx, s.userId, { kind: 'system', title: `${t.name} has ended`, body: `You finished in place ${i + 1}.`, link: `/tournaments/${t.slug}` });
      }
      await tx.update(tournaments).set({ status: 'FINISHED', finalizedAt: now }).where(eq(tournaments.id, t.id));
      await audit(tx, { actorType: 'SYSTEM', action: 'tournament.finalized', resourceType: 'tournament', resourceId: String(t.id), after: { ranked: final.length } });
      return true;
    });
    if (done) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Back office (promotions:manage)
// ---------------------------------------------------------------------------

export const tournamentCreateSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{3,40}$/, 'Slug: 3–40 lower-case letters, digits or dashes'),
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().min(3).max(600),
    gameIds: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(30).default([]),
    metric: z.enum(['BEST_MULTIPLIER', 'TOP3_MULTIPLIERS']),
    minStake: z.int().min(1).max(100_000_000),
    minVipLevel: z.int().min(1).max(10).default(1),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    prizes: z.array(z.int().min(1).max(10_000_000)).min(1).max(50),
  })
  .strict()
  .refine((t) => Date.parse(t.endsAt) > Date.parse(t.startsAt), { message: 'The end must be after the start', path: ['endsAt'] })
  .refine((t) => t.prizes.every((p, i) => i === 0 || p <= t.prizes[i - 1]!), { message: 'Prizes must not increase with rank', path: ['prizes'] });

export async function createTournament(ctx: AdminCtx, raw: z.input<typeof tournamentCreateSchema>, reason: string, now = new Date()) {
  const parsed = tournamentCreateSchema.safeParse(raw);
  if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Invalid tournament', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  const input = parsed.data;
  if (Date.parse(input.endsAt) <= now.getTime()) throw errors.validation('The tournament must end in the future.');
  return withTransaction(async (tx) => {
    if (input.gameIds.length) {
      const found = await tx.select({ id: games.id }).from(games).where(inArray(games.id, input.gameIds));
      if (found.length !== new Set(input.gameIds).size) throw errors.validation('Unknown game in the list.');
    }
    const [dup] = await tx.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.slug, input.slug));
    if (dup) throw errors.conflict('A tournament with this slug exists.');
    const [t] = await tx
      .insert(tournaments)
      .values({ ...input, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), createdBy: ctx.adminId })
      .returning();
    await recordAdminAction(tx, { ...ctx, action: 'tournament.created', targetType: 'tournament', targetId: String(t!.id), reason, after: { ...input } });
    return view(t!, now);
  });
}

export async function cancelTournament(ctx: AdminCtx, id: number, reason: string, now = new Date()) {
  return withTransaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).for('update');
    if (!t) throw errors.notFound('Tournament');
    if (t.status !== 'SCHEDULED') throw errors.conflict('Only a tournament that has not been finalised can be cancelled.');
    await tx.update(tournaments).set({ status: 'CANCELLED' }).where(eq(tournaments.id, id));
    const entrants = await tx.select({ userId: tournamentEntries.userId }).from(tournamentEntries).where(eq(tournamentEntries.tournamentId, id));
    for (const e of entrants) await notify(tx, e.userId, { kind: 'system', title: `${t.name} was cancelled`, body: `The tournament was cancelled: ${reason}`, link: '/tournaments' });
    await recordAdminAction(tx, { ...ctx, action: 'tournament.cancelled', targetType: 'tournament', targetId: String(id), reason, before: { status: t.status } });
    return view({ ...t, status: 'CANCELLED' }, now);
  });
}
