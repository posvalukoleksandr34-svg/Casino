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
