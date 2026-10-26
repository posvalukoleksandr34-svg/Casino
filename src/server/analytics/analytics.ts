/**
 * Analytics over *recorded* rounds only — simulated figures never mix in.
 *
 * For each settled round the risk engine stored the theoretical expected
 * payout E_i and payout variance V_i under the documented rules. Over a set
 * of rounds:
 *   theoretical RTP   = Σ E_i / Σ stake_i
 *   actual RTP        = Σ payout_i / Σ stake_i
 *   z                 = (Σ payout_i − Σ E_i) / sqrt(Σ V_i)
 * so deviations are judged against their own sampling variability: a large
 * |z| is a statistical anomaly worth investigating, a small one is normal
 * variance however large the money swing looks.
 */
import { sql } from 'drizzle-orm';
import { normalQuantile, payoutZScore, twoSidedP } from '@/engine/stats';
import { getDb } from '../db/client';

export interface Period {
  from?: Date;
  to?: Date;
}

export interface GameMetrics {
  gameId: string;
  rounds: number;
  stake: number;
  payout: number;
  expectedPayout: number;
  payoutStdDev: number;
  ggr: number;
  theoreticalGgr: number;
  actualRtp: number | null;
  theoreticalRtp: number | null;
  rtpCi95: [number, number] | null;
  zScore: number | null;
  pValue: number | null;
  realizedMargin: number | null;
  theoreticalMargin: number | null;
  distribution: { lost: number; partial: number; push: number; upTo2x: number; upTo10x: number; upTo100x: number; above100x: number };
  maxMultiplier: number;
  roundStdDev: number | null;
}

function periodSql(p: Period) {
  return sql`${p.from ? sql`AND settled_at >= ${p.from}` : sql``} ${p.to ? sql`AND settled_at < ${p.to}` : sql``}`;
}

export async function gameMetrics(period: Period = {}): Promise<GameMetrics[]> {
  const res = await getDb().execute<{
    game_id: string;
    rounds: number;
    stake: string;
    payout: string;
    expected: number;
    variance: number;
    lost: number;
    partial: number;
    push: number;
    up2: number;
    up10: number;
    up100: number;
    above100: number;
    max_mult: number | null;
    sumsq_net_ratio: number | null;
  }>(sql`
    SELECT game_id,
      count(*)::int AS rounds,
      sum(stake_total)::text AS stake,
      sum(payout_total)::text AS payout,
      sum(expected_payout)::float8 AS expected,
      sum(payout_variance)::float8 AS variance,
      count(*) FILTER (WHERE payout_total = 0)::int AS lost,
      count(*) FILTER (WHERE payout_total > 0 AND payout_total < stake_total)::int AS partial,
      count(*) FILTER (WHERE payout_total = stake_total)::int AS push,
      count(*) FILTER (WHERE payout_total > stake_total AND payout_total <= 2 * stake_total)::int AS up2,
      count(*) FILTER (WHERE payout_total > 2 * stake_total AND payout_total <= 10 * stake_total)::int AS up10,
      count(*) FILTER (WHERE payout_total > 10 * stake_total AND payout_total <= 100 * stake_total)::int AS up100,
      count(*) FILTER (WHERE payout_total > 100 * stake_total)::int AS above100,
      max(payout_total::float8 / stake_total) AS max_mult,
      stddev_samp((payout_total - stake_total)::float8 / stake_total) AS sumsq_net_ratio
    FROM game_rounds
    WHERE status = 'SETTLED' ${periodSql(period)}
    GROUP BY game_id
    ORDER BY game_id`);
  return res.rows.map((r) => {
    const stake = Number(r.stake);
    const payout = Number(r.payout);
    const sd = Math.sqrt(Math.max(0, r.variance));
    const z = payoutZScore(payout, r.expected, r.variance);
    const zc = normalQuantile(0.975);
    return {
      gameId: r.game_id,
      rounds: r.rounds,
      stake,
      payout,
      expectedPayout: r.expected,
      payoutStdDev: sd,
      ggr: stake - payout,
      theoreticalGgr: stake - r.expected,
      actualRtp: stake > 0 ? payout / stake : null,
      theoreticalRtp: stake > 0 ? r.expected / stake : null,
      // 95% band for actual RTP if the game behaves exactly as documented.
      rtpCi95: stake > 0 ? [(r.expected - zc * sd) / stake, (r.expected + zc * sd) / stake] : null,
      zScore: z,
      pValue: z === null ? null : twoSidedP(z),
      realizedMargin: stake > 0 ? (stake - payout) / stake : null,
      theoreticalMargin: stake > 0 ? (stake - r.expected) / stake : null,
      distribution: {
        lost: r.lost,
        partial: r.partial,
        push: r.push,
        upTo2x: r.up2,
        upTo10x: r.up10,
        upTo100x: r.up100,
        above100x: r.above100,
      },
      maxMultiplier: r.max_mult ?? 0,
      roundStdDev: r.sumsq_net_ratio,
    };
  });
}

export interface DailyPoint {
  day: string;
  gameId: string;
  rounds: number;
  stake: number;
  payout: number;
  expectedPayout: number;
}

export async function dailySeries(days = 30, gameId?: string): Promise<DailyPoint[]> {
  const res = await getDb().execute<{ day: string; game_id: string; rounds: number; stake: string; payout: string; expected: number }>(sql`
    SELECT to_char(date_trunc('day', settled_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, game_id,
           count(*)::int AS rounds, sum(stake_total)::text AS stake, sum(payout_total)::text AS payout,
           sum(expected_payout)::float8 AS expected
    FROM game_rounds
    WHERE status = 'SETTLED' AND settled_at >= now() - make_interval(days => ${days})
      ${gameId ? sql`AND game_id = ${gameId}` : sql``}
    GROUP BY 1, 2 ORDER BY 1, 2`);
  return res.rows.map((r) => ({
    day: r.day,
    gameId: r.game_id,
    rounds: r.rounds,
    stake: Number(r.stake),
    payout: Number(r.payout),
    expectedPayout: r.expected,
  }));
}

export interface ExposureRow {
  gameId: string;
  openRounds: number;
  openStake: number;
  netExposure: number;
  limit: number;
}

export async function exposureByGame(): Promise<ExposureRow[]> {
  const res = await getDb().execute<{ game_id: string; open_rounds: number; open_stake: string; net: string; limit: string }>(sql`
    SELECT g.id AS game_id,
           count(r.id)::int AS open_rounds,
           coalesce(sum(r.stake_total), 0)::text AS open_stake,
           coalesce(sum(greatest(r.max_payout - r.stake_total, 0)), 0)::text AS net,
           l.max_game_exposure::text AS limit
    FROM games g
    JOIN risk_limits l ON l.game_id = g.id
    LEFT JOIN game_rounds r ON r.game_id = g.id AND r.status = 'OPEN'
    GROUP BY g.id, l.max_game_exposure, g.sort_order
    ORDER BY g.sort_order`);
  return res.rows.map((r) => ({
    gameId: r.game_id,
    openRounds: r.open_rounds,
    openStake: Number(r.open_stake),
    netExposure: Number(r.net),
    limit: Number(r.limit),
  }));
}

export async function bonusCost(period: Period = {}): Promise<number> {
  const res = await getDb().execute<{ total: string }>(sql`
    SELECT coalesce(sum(amount), 0)::text AS total FROM bonuses
    WHERE true ${period.from ? sql`AND created_at >= ${period.from}` : sql``} ${period.to ? sql`AND created_at < ${period.to}` : sql``}`);
  return Number(res.rows[0]?.total ?? 0);
}

/** Platform-level summary. NGR = GGR − promotional cost (the only documented expense in a virtual product). */
export async function platformSummary(period: Period = {}) {
  const games = await gameMetrics(period);
  const stake = games.reduce((a, g) => a + g.stake, 0);
  const payout = games.reduce((a, g) => a + g.payout, 0);
  const expected = games.reduce((a, g) => a + g.expectedPayout, 0);
  const variance = games.reduce((a, g) => a + g.payoutStdDev ** 2, 0);
  const bonuses = await bonusCost(period);
  const z = payoutZScore(payout, expected, variance);
  return {
    rounds: games.reduce((a, g) => a + g.rounds, 0),
    stake,
    payout,
    expectedPayout: expected,
    ggr: stake - payout,
    theoreticalGgr: stake - expected,
    bonusCost: bonuses,
    ngr: stake - payout - bonuses,
    actualRtp: stake > 0 ? payout / stake : null,
    theoreticalRtp: stake > 0 ? expected / stake : null,
    zScore: z,
    pValue: z === null ? null : twoSidedP(z),
    ggrStdDev: Math.sqrt(variance),
    games,
  };
}
