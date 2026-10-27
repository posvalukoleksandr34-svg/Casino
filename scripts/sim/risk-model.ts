/**
 * Bankroll / reserve Monte Carlo model (SIMULATED — never mixed with live data).
 *
 * What it models
 *   * House P&L from independent player rounds over a horizon of days.
 *   * Each round: a game (by volume mix), a bet scenario within the game, a
 *     stake (log-normal, clamped to the game's table limits and to its
 *     per-round payout cap), and an outcome drawn from the scenario's payout
 *     distribution.
 *   * Payout distributions come from the production engine's own payout
 *     functions (exact for roulette, dice, mines with a fixed cash-out step,
 *     crash with an automatic target; empirical basic-strategy histogram for
 *     blackjack, whose n is reported). Payouts are floored to the minor unit
 *     exactly as in production.
 *
 * What it does not model (stated, not hidden)
 *   * Outcome correlation between players: every round has its own provably
 *     fair draw (single-player crash/roulette), so outcomes are independent
 *     by construction. Correlation can only come from player behaviour (e.g.
 *     many players raising stakes together); use --stake-median/--stake-sigma
 *     and --rounds-per-day to stress that.
 *   * Bonus cost (promotions) and adjustments: not part of game GGR.
 *   * Open-round liability timing: rounds are instantaneous here; the
 *     exposure caps that bound simultaneous liability are reported separately
 *     as a deterministic stress figure.
 */
import { blackjack, allowedActions, applyAction, dealFromShoe, type BlackjackState } from '../../src/engine/games/blackjack';
import { basicStrategy } from '../../src/engine/games/blackjack/strategy';
import { crash, survivalAt } from '../../src/engine/games/crash';
import { dice, multiplierE4For } from '../../src/engine/games/dice';
import { hilo, hiloMultiplierE4, likelierSide, successNumerator } from '../../src/engine/games/hilo';
import { keno, kenoHitProbability } from '../../src/engine/games/keno';
import { limbo, limboWinProbability } from '../../src/engine/games/limbo';
import { mines, multiplierE4 as minesMultiplierE4, survivalProbability } from '../../src/engine/games/mines';
import { plinko, plinkoKey, plinkoSlotProbability, type PlinkoRisk } from '../../src/engine/games/plinko';
import { PAYOUT_ODDS, WINNING_POCKETS, type RouletteBetType } from '../../src/engine/games/roulette/rules';
import type { StepResult } from '../../src/engine/games/types';
import { SimulationRandom } from '../../src/engine/rng/sim-random';

export const RISK_GAMES = ['roulette', 'dice', 'mines', 'crash', 'blackjack', 'limbo', 'keno', 'plinko', 'hilo'] as const;
export type GameId = (typeof RISK_GAMES)[number];

/** One possible result per unit of initial stake: total stake multiple and gross payout multiple (×10⁴). */
export interface Outcome {
  p: number;
  stakeX: number;
  payoutE4: number;
}

export interface Scenario {
  game: GameId;
  name: string;
  /** Relative share of this scenario within its game. */
  weight: number;
  outcomes: Outcome[];
  /** Largest gross payout multiple (×10⁴) per unit initial stake. */
  maxPayoutE4: number;
  /** "exact" or "empirical (n)". */
  source: string;
}

export interface Limits {
  minStake: number;
  maxStake: number;
  maxPayoutPerRound: number;
}

/** Vose alias table for O(1) sampling from a discrete distribution. */
export class Alias {
  private prob: Float64Array;
  private alias: Int32Array;
  constructor(weights: readonly number[]) {
    const n = weights.length;
    const total = weights.reduce((a, b) => a + b, 0);
    const scaled = weights.map((w) => (w * n) / total);
    this.prob = new Float64Array(n);
    this.alias = new Int32Array(n);
    const small: number[] = [];
    const large: number[] = [];
    scaled.forEach((s, i) => (s < 1 ? small : large).push(i));
    while (small.length && large.length) {
      const s = small.pop()!;
      const l = large.pop()!;
      this.prob[s] = scaled[s]!;
      this.alias[s] = l;
      scaled[l] = scaled[l]! + scaled[s]! - 1;
      (scaled[l]! < 1 ? small : large).push(l);
    }
    for (const i of [...small, ...large]) this.prob[i] = 1;
  }
  sample(rng: SimulationRandom): number {
    const i = rng.nextInt(this.prob.length);
    return rng.nextFloat() < this.prob[i]! ? i : this.alias[i]!;
  }
}

function binary(p: number, multE4: number): Outcome[] {
  return [
    { p, stakeX: 1, payoutE4: multE4 },
    { p: 1 - p, stakeX: 1, payoutE4: 0 },
  ];
}

function exact(game: GameId, name: string, weight: number, outcomes: Outcome[]): Scenario {
  return { game, name, weight, outcomes, maxPayoutE4: Math.max(...outcomes.map((o) => o.payoutE4)), source: 'exact' };
}

/** Merges outcomes with the same payout multiple. */
function grouped(pairs: { p: number; payoutE4: number }[]): Outcome[] {
  const m = new Map<number, number>();
  for (const o of pairs) if (o.p > 0) m.set(o.payoutE4, (m.get(o.payoutE4) ?? 0) + o.p);
  return [...m.entries()].map(([payoutE4, p]) => ({ p, stakeX: 1, payoutE4 }));
}

/** Hi-Lo "guess the likelier side, cash out after k correct guesses (or at the cap)": exact path distribution. */
function hiloOutcomes(k: number): Outcome[] {
  const c = hilo.defaultConfig;
  const out: { p: number; payoutE4: number }[] = [];
  const walk = (rank: number, factors: number[], prob: number) => {
    const m = factors.length ? Math.min(hiloMultiplierE4(c.houseEdgeBp, factors), c.maxMultiplierE4) : 0;
    if (factors.length === k || (factors.length && m >= c.maxMultiplierE4)) {
      out.push({ p: prob, payoutE4: m });
      return;
    }
    const side = likelierSide(rank);
    for (let next = 1; next <= 13; next += 1) {
      const win = side === 'higher' ? next > rank : next < rank;
      if (win) walk(next, [...factors, successNumerator(rank, side)], prob / 13);
      else out.push({ p: prob / 13, payoutE4: 0 });
    }
  };
  for (let first = 1; first <= 13; first += 1) walk(first, [], 1 / 13);
  return grouped(out);
}

/** Empirical blackjack histogram under basic strategy (no insurance), via the production engine. */
export function blackjackScenario(hands: number, seed: [number, number, number, number]): Scenario {
  const config = blackjack.defaultConfig;
  const rng = new SimulationRandom(seed);
  const UNIT = 1_000_000;
  const counts = new Map<string, number>();
  const size = 52 * config.decks;
  for (let n = 0; n < hands; n += 1) {
    const deck = Array.from({ length: size }, (_, i) => i);
    for (let i = 0; i < 100; i += 1) {
      const j = i + rng.nextInt(size - i);
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    let step: StepResult<BlackjackState> = dealFromShoe(config, { amount: UNIT }, deck);
    let staked = UNIT;
    while (step.status === 'OPEN') {
      const s = step.state;
      if (s.phase === 'insurance') step = applyAction(config, s, { type: 'insurance', take: false });
      else {
        const type = basicStrategy(s.hands[s.active]!.cards, s.dealer[0]!, allowedActions(config, s), config) as 'hit' | 'stand' | 'double' | 'split';
        step = applyAction(config, s, { type });
      }
      for (const e of step.additionalStakes) staked += e.amount;
    }
    const k = `${staked / UNIT}:${Math.round((step.payout / UNIT) * 10_000)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const outcomes = [...counts.entries()].map(([k, c]) => {
    const [stakeX, payoutE4] = k.split(':').map(Number);
    return { p: c / hands, stakeX: stakeX!, payoutE4: payoutE4! };
  });
  return { game: 'blackjack', name: 'basic strategy', weight: 1, outcomes, maxPayoutE4: 16 * 10_000, source: `empirical (${hands.toLocaleString('en-US')} hands)` };
}

/** Default bet scenarios per game (weights are shares within the game). */
export function defaultScenarios(blackjackHands = 200_000, seed: [number, number, number, number] = [1, 2, 3, 4]): Scenario[] {
  const d = dice.defaultConfig;
  const m = mines.defaultConfig;
  const c = crash.defaultConfig;
  const roulette = (type: RouletteBetType, weight: number) =>
    exact('roulette', type, weight, binary(WINNING_POCKETS[type] / 37, (PAYOUT_ODDS[type] + 1) * 10_000));
  return [
    roulette('red', 0.45),
    roulette('dozen', 0.25),
    roulette('straight', 0.3),
    ...[
      [4950, 0.5],
      [9000, 0.2],
      [1000, 0.2],
      [100, 0.1],
    ].map(([w, weight]) => exact('dice', `win chance ${w! / 100}%`, weight!, binary(w! / 10_000, multiplierE4For(w!, d.houseEdgeBp)))),
    ...[
      [3, 3, 0.5],
      [1, 5, 0.2],
      [5, 4, 0.2],
      [24, 1, 0.1],
    ].map(([mines_, k, weight]) =>
      exact('mines', `${mines_} mines, ${k} picks`, weight!, binary(survivalProbability(mines_!, k!), minesMultiplierE4(m, mines_!, k!))),
    ),
    ...[
      [150, 0.3],
      [200, 0.4],
      [1000, 0.2],
      [10_000, 0.1],
    ].map(([x, weight]) => exact('crash', `auto ${x! / 100}×`, weight!, binary(survivalAt(x!, c.houseEdgeBp), x! * 100))),
    blackjackScenario(blackjackHands, seed),
    ...[
      [150, 0.3],
      [200, 0.4],
      [1000, 0.2],
      [10_000, 0.1],
    ].map(([t, weight]) => exact('limbo', `target ${t! / 100}×`, weight!, binary(limboWinProbability(t!, limbo.defaultConfig.houseEdgeBp), t! * 100))),
    ...[
      [2, 0.3],
      [5, 0.3],
      [8, 0.2],
      [10, 0.2],
    ].map(([n, weight]) =>
      exact('keno', `${n} picks`, weight!, grouped(keno.defaultConfig.table[String(n)]!.map((m, k) => ({ p: kenoHitProbability(n!, k), payoutE4: m * 100 })))),
    ),
    ...([
      [8, 'low', 0.3],
      [12, 'medium', 0.4],
      [16, 'high', 0.3],
    ] as [number, PlinkoRisk, number][]).map(([rows, risk, weight]) =>
      exact('plinko', `${rows} rows ${risk}`, weight, grouped(plinko.defaultConfig.tables[plinkoKey(rows, risk)]!.map((m, k) => ({ p: plinkoSlotProbability(rows, k), payoutE4: m * 100 })))),
    ),
    ...[
      [1, 0.4],
      [2, 0.3],
      [4, 0.3],
    ].map(([k, weight]) => exact('hilo', `likelier side, cash out after ${k}`, weight!, hiloOutcomes(k!))),
  ];
}

export interface RunConfig {
  days: number;
  paths: number;
  roundsPerDay: number;
  /** Median stake in minor units and log-normal sigma. */
  stakeMedian: number;
  stakeSigma: number;
  /** Volume share per game; games left out get none. */
  mix: Partial<Record<GameId, number>>;
  limits: Partial<Record<GameId, Limits>>;
  seed: [number, number, number, number];
}

export interface PathResult {
  pnl: number;
  maxDrawdown: number;
  worstDay: number;
  largestPayout: number;
  losingDays: number;
  stakes: number;
}

function lognormal(rng: SimulationRandom, median: number, sigma: number): number {
  const u1 = Math.max(rng.nextFloat(), Number.MIN_VALUE);
  const u2 = rng.nextFloat();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(sigma * z);
}

/** Expected house result per round (minor units) for the configured mix, from the distributions. */
export function expectedEdgePerUnit(scenarios: Scenario[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of scenarios) {
    const e = s.outcomes.reduce((a, o) => a + o.p * (o.stakeX - o.payoutE4 / 10_000), 0);
    out.set(`${s.game}:${s.name}`, e);
  }
  return out;
}

export function simulate(cfg: RunConfig, scenarios: Scenario[]): { paths: PathResult[]; theoreticalPnl: number } {
  const rng = new SimulationRandom(cfg.seed);
  const games = (Object.keys(cfg.mix) as GameId[]).filter((g) => (cfg.mix[g] ?? 0) > 0);
  for (const g of games) if (!cfg.limits[g]) throw new Error(`no limits configured for ${g}`);
  const gameAlias = new Alias(games.map((g) => cfg.mix[g]!));
  const byGame = games.map((g) => scenarios.filter((s) => s.game === g));
  const scenarioAlias = byGame.map((list) => new Alias(list.map((s) => s.weight)));
  const outcomeAlias = byGame.map((list) => list.map((s) => new Alias(s.outcomes.map((o) => o.p))));
  // Expected house result per unit of initial stake, per scenario.
  const edge = byGame.map((list) => list.map((s) => s.outcomes.reduce((a, o) => a + o.p * (o.stakeX - o.payoutE4 / 10_000), 0)));
  // Largest stake each scenario accepts under its game's limits (the risk engine rejects larger ones).
  const stakeCap = byGame.map((list, gi) => {
    const l = cfg.limits[games[gi]!]!;
    return list.map((s) => Math.max(l.minStake, Math.min(l.maxStake, Math.floor((l.maxPayoutPerRound * 10_000) / s.maxPayoutE4))));
  });

  let theoretical = 0;
  const paths: PathResult[] = [];
  for (let p = 0; p < cfg.paths; p += 1) {
    let pnl = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let worstDay = 0;
    let largestPayout = 0;
    let losingDays = 0;
    let stakes = 0;
    for (let d = 0; d < cfg.days; d += 1) {
      let day = 0;
      for (let r = 0; r < cfg.roundsPerDay; r += 1) {
        const gi = gameAlias.sample(rng);
        const si = scenarioAlias[gi]!.sample(rng);
        const sc = byGame[gi]![si]!;
        const l = cfg.limits[games[gi]!]!;
        const stake = Math.min(stakeCap[gi]![si]!, Math.max(l.minStake, Math.round(lognormal(rng, cfg.stakeMedian, cfg.stakeSigma))));
        const o = sc.outcomes[outcomeAlias[gi]![si]!.sample(rng)]!;
        const staked = stake * o.stakeX;
        const payout = Math.floor((stake * o.payoutE4) / 10_000);
        theoretical += stake * edge[gi]![si]!;
        day += staked - payout;
        stakes += staked;
        if (payout > largestPayout) largestPayout = payout;
      }
      pnl += day;
      if (day < worstDay) worstDay = day;
      if (day < 0) losingDays += 1;
      if (pnl > peak) peak = pnl;
      if (peak - pnl > maxDrawdown) maxDrawdown = peak - pnl;
    }
    paths.push({ pnl, maxDrawdown, worstDay, largestPayout, losingDays, stakes });
  }
  return { paths, theoreticalPnl: theoretical / cfg.paths };
}

/**
 * Empirical quantile with a 95% order-statistic confidence interval.
 * `reliable` is false when fewer than ~10 samples lie beyond the quantile
 * (the interval then collapses onto the sample extreme): run more paths.
 */
export function quantile(values: number[], q: number): { value: number; ci95: [number, number]; reliable: boolean } {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const at = (i: number) => s[Math.min(n - 1, Math.max(0, i))]!;
  const k = q * (n - 1);
  const lo = Math.floor(k);
  const value = at(lo) + (at(lo + 1) - at(lo)) * (k - lo);
  const half = 1.96 * Math.sqrt(n * q * (1 - q));
  return { value, ci95: [at(Math.floor(q * n - half)), at(Math.ceil(q * n + half))], reliable: n * Math.min(q, 1 - q) >= 10 };
}

export function meanCi(values: number[]): { mean: number; ci95: [number, number] } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const h = 1.96 * Math.sqrt(v / n);
  return { mean, ci95: [mean - h, mean + h] };
}
