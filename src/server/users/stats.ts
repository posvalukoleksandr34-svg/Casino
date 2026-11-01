import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';

export interface PlayerGameStats {
  gameId: string;
  rounds: number;
  wagered: number;
  paidOut: number;
  net: number;
  /** Rounds that returned more than the stake. */
  wins: number;
  /** Rounds that returned less than the stake (including partial returns). */
  losses: number;
  /** Rounds that returned exactly the stake (pushes). */
  draws: number;
  biggestPayout: number;
  bestMultiplier: number;
}

/** Realised results per game for one player (settled rounds only). */
export async function playerStats(userId: string): Promise<{ games: PlayerGameStats[]; totals: Omit<PlayerGameStats, 'gameId'> }> {
  const res = await getDb().execute<{
    game_id: string;
    rounds: number;
    wagered: string;
    paid: string;
    wins: number;
    losses: number;
    draws: number;
    biggest: string;
    best_mult: number | null;
  }>(sql`
    SELECT game_id,
           count(*)::int AS rounds,
           sum(stake_total)::text AS wagered,
           sum(payout_total)::text AS paid,
           count(*) FILTER (WHERE payout_total > stake_total)::int AS wins,
           count(*) FILTER (WHERE payout_total < stake_total)::int AS losses,
           count(*) FILTER (WHERE payout_total = stake_total)::int AS draws,
           max(payout_total)::text AS biggest,
           max(payout_total::float8 / stake_total) AS best_mult
    FROM game_rounds
    WHERE user_id = ${userId} AND status = 'SETTLED'
    GROUP BY game_id
    ORDER BY game_id`);
  const games = res.rows.map((r) => ({
    gameId: r.game_id,
    rounds: r.rounds,
    wagered: Number(r.wagered),
    paidOut: Number(r.paid),
    net: Number(r.paid) - Number(r.wagered),
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    biggestPayout: Number(r.biggest),
    bestMultiplier: r.best_mult ?? 0,
  }));
  const totals = games.reduce(
    (a, g) => ({
      rounds: a.rounds + g.rounds,
      wagered: a.wagered + g.wagered,
      paidOut: a.paidOut + g.paidOut,
      net: a.net + g.net,
      wins: a.wins + g.wins,
      losses: a.losses + g.losses,
      draws: a.draws + g.draws,
      biggestPayout: Math.max(a.biggestPayout, g.biggestPayout),
      bestMultiplier: Math.max(a.bestMultiplier, g.bestMultiplier),
    }),
    { rounds: 0, wagered: 0, paidOut: 0, net: 0, wins: 0, losses: 0, draws: 0, biggestPayout: 0, bestMultiplier: 0 },
  );
  return { games, totals };
}

export interface DailyResult {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  rounds: number;
  wagered: number;
  paidOut: number;
  net: number;
}

/**
 * The player's settled rounds per UTC day over the last `days` days (oldest
 * first), with every day present — days without play have zero rounds — so
 * charts show gaps honestly.
 */
export async function dailyResults(userId: string, days = 30, now = new Date()): Promise<DailyResult[]> {
  const span = Math.min(Math.max(Math.trunc(days), 1), 365);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - (span - 1) * 86_400_000);
  const res = await getDb().execute<{ day: string; rounds: number; wagered: string; paid: string }>(sql`
    SELECT to_char((settled_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
           count(*)::int AS rounds,
           sum(stake_total)::text AS wagered,
           sum(payout_total)::text AS paid
    FROM game_rounds
    WHERE user_id = ${userId} AND status = 'SETTLED' AND settled_at >= ${start.toISOString()}::timestamptz
    GROUP BY 1`);
  const byDay = new Map(res.rows.map((r) => [r.day, r]));
  return Array.from({ length: span }, (_, i) => {
    const day = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    const wagered = r ? Number(r.wagered) : 0;
    const paidOut = r ? Number(r.paid) : 0;
    return { day, rounds: r?.rounds ?? 0, wagered, paidOut, net: paidOut - wagered };
  });
}
