/**
 * Video slots (instant, server-authoritative): 5 reels × 4 rows, "ways" pays.
 *
 * Each reel is a circular strip of symbols; a spin draws one uniform stop per
 * reel from the provably fair stream (`nextInt(strip length)`) and shows the 4
 * consecutive symbols from that stop. A symbol pays when it appears on reels
 * 1, 2, 3 … in a row from the left (wilds substitute on reels 2–5); the win is
 * pay[k] × (product of its counts on those k reels) for a run of k ≥ 3 reels,
 * summed over symbols. Pays are hundredths of the total stake per way.
 *
 * Three or more scatters anywhere award a fixed number of free spins played on
 * the same reels with a win multiplier. Free spins draw further stops from the
 * same stream, never retrigger, and settle with the round: one wager, one
 * settlement, every reel position replayable from the round's seeds.
 *
 * The maths is exact. `analyseMachine` enumerates every combination of reel
 * stops (grouped by identical windows) and returns the exact RTP as a
 * fraction, the variance and the exact maximum round multiple; the
 * configuration schema refuses any machine whose RTP is not strictly below
 * 100% or whose maximum exceeds the platform multiplier cap.
 */
import { z } from 'zod';
import { MAX_MULTIPLIER, mulDivFloor } from '../../money';
import type { RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { GameRuleError, notInteractive, settled, type GameId, type GameModule, type RiskProfile } from '../types';

export const SLOT_REELS = 5;
export const SLOT_ROWS = 4;
export const SLOT_MIN_RUN = 3;

const symbolSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,24}$/),
    name: z.string().min(1).max(40),
    kind: z.enum(['wild', 'scatter', 'high', 'low']),
    /** Hundredths of the stake per way for runs of 3, 4 and 5 reels (wild and scatter: [0,0,0]). */
    pays: z.tuple([z.int().min(0), z.int().min(0), z.int().min(0)]),
  })
  .strict();

export const slotConfigSchema = z
  .object({
    symbols: z.array(symbolSchema).min(4).max(16),
    reels: z.array(z.array(z.string()).min(SLOT_ROWS + 1).max(200)).length(SLOT_REELS),
    freeSpins: z
      .object({
        /** Free spins awarded for 3, 4 and 5+ scatters. */
        awards: z.tuple([z.int().min(1).max(50), z.int().min(1).max(50), z.int().min(1).max(50)]),
        multiplier: z.int().min(1).max(10),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = c.symbols.map((s) => s.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'symbol ids must be unique' });
    if (c.symbols.filter((s) => s.kind === 'wild').length !== 1) ctx.addIssue({ code: 'custom', message: 'exactly one wild symbol' });
    if (c.symbols.filter((s) => s.kind === 'scatter').length !== 1) ctx.addIssue({ code: 'custom', message: 'exactly one scatter symbol' });
    for (const s of c.symbols) {
      if ((s.kind === 'wild' || s.kind === 'scatter') && s.pays.some((p) => p !== 0)) ctx.addIssue({ code: 'custom', message: `${s.id}: wild and scatter pay nothing on their own` });
      if (s.pays[1] < s.pays[0] || s.pays[2] < s.pays[1]) ctx.addIssue({ code: 'custom', message: `${s.id}: longer runs must never pay less` });
    }
    const wild = c.symbols.find((s) => s.kind === 'wild')?.id;
    c.reels.forEach((strip, i) => {
      for (const sym of strip) if (!ids.includes(sym)) ctx.addIssue({ code: 'custom', message: `reel ${i + 1}: unknown symbol ${sym}` });
      if (i === 0 && wild && strip.includes(wild)) ctx.addIssue({ code: 'custom', message: 'wilds may not appear on reel 1' });
    });
    if (c.freeSpins.awards[1] < c.freeSpins.awards[0] || c.freeSpins.awards[2] < c.freeSpins.awards[1]) ctx.addIssue({ code: 'custom', message: 'more scatters must never award fewer free spins' });
    if (c.reels.some((r) => r.some((sym) => !ids.includes(sym))) || ids.length !== new Set(ids).size) return;
    if (c.symbols.filter((s) => s.kind === 'wild').length !== 1 || c.symbols.filter((s) => s.kind === 'scatter').length !== 1) return;
    const a = analyseMachine(c);
    if (a.rtpNum >= a.rtpDen) ctx.addIssue({ code: 'custom', message: 'RTP must be strictly below 100%' });
    if (a.maxTotalE2 > MAX_MULTIPLIER * 100) ctx.addIssue({ code: 'custom', message: `maximum win ${a.maxTotalE2 / 100}× exceeds the ${MAX_MULTIPLIER}× cap` });
  });
export type SlotConfig = z.infer<typeof slotConfigSchema>;

export const slotBetSchema = z.object({ amount: stakeSchema }).strict();
export type SlotBet = z.infer<typeof slotBetSchema>;

export interface SlotWin {
  symbol: string;
  /** Reels in the run (3–5). */
  reels: number;
  ways: number;
  /** Win in hundredths of the stake (before the free-spins multiplier). */
  winE2: number;
  /** Cells that make up the win: [reel, row]. */
  cells: [number, number][];
}

export interface SlotSpin {
  stops: number[];
  /** grid[reel][row], top to bottom. */
  grid: string[][];
  wins: SlotWin[];
  /** Spin win in hundredths of the stake, multiplier applied. */
  winE2: number;
  scatters: number;
}

export interface SlotState {
  amount: number;
  base: SlotSpin;
  freeSpins: SlotSpin[];
  multiplier: number;
  /** Whole-round win in hundredths of the stake. */
  totalE2: number;
  payout: number;
}

/** The 4 visible symbols of a strip from a stop (wrapping). */
export function windowAt(strip: readonly string[], stop: number): string[] {
  return Array.from({ length: SLOT_ROWS }, (_, r) => strip[(stop + r) % strip.length]!);
}

interface Roles {
  wild: string;
  scatter: string;
  paying: { id: string; pays: readonly [number, number, number] }[];
}

function roles(config: SlotConfig): Roles {
  return {
    wild: config.symbols.find((s) => s.kind === 'wild')!.id,
    scatter: config.symbols.find((s) => s.kind === 'scatter')!.id,
    paying: config.symbols.filter((s) => s.kind === 'high' || s.kind === 'low').map((s) => ({ id: s.id, pays: s.pays })),
  };
}

/** Evaluates a grid (no multiplier). */
export function evaluateGrid(config: SlotConfig, grid: string[][]): { wins: SlotWin[]; winE2: number; scatters: number } {
  const { wild, scatter, paying } = roles(config);
  const wins: SlotWin[] = [];
  for (const sym of paying) {
    let ways = 1;
    let run = 0;
    const cells: [number, number][] = [];
    for (let reel = 0; reel < SLOT_REELS; reel += 1) {
      const hits = grid[reel]!.map((s, row) => (s === sym.id || s === wild ? row : -1)).filter((r) => r >= 0);
      if (hits.length === 0) break;
      run += 1;
      ways *= hits.length;
      for (const row of hits) cells.push([reel, row]);
    }
    if (run >= SLOT_MIN_RUN) {
      const pay = sym.pays[run - SLOT_MIN_RUN]!;
      if (pay > 0) wins.push({ symbol: sym.id, reels: run, ways, winE2: pay * ways, cells });
    }
  }
  const scatters = grid.reduce((n, col) => n + col.filter((s) => s === scatter).length, 0);
  return { wins, winE2: wins.reduce((s, w) => s + w.winE2, 0), scatters };
}

export function awardFor(config: SlotConfig, scatters: number): number {
  if (scatters < 3) return 0;
  return config.freeSpins.awards[Math.min(scatters, 5) - 3]!;
}

function spin(config: SlotConfig, rng: RandomSource, multiplier: number): SlotSpin {
  const stops = config.reels.map((strip) => rng.nextInt(strip.length));
  const grid = stops.map((stop, i) => windowAt(config.reels[i]!, stop));
  const e = evaluateGrid(config, grid);
  return { stops, grid, wins: e.wins, winE2: e.winE2 * multiplier, scatters: e.scatters };
}

/** Plays a whole round: the base spin and any free spins, from one stream. */
export function playSlotRound(config: SlotConfig, rng: RandomSource): { base: SlotSpin; freeSpins: SlotSpin[]; totalE2: number } {
  const base = spin(config, rng, 1);
  const freeSpins = Array.from({ length: awardFor(config, base.scatters) }, () => spin(config, rng, config.freeSpins.multiplier));
  return { base, freeSpins, totalE2: base.winE2 + freeSpins.reduce((s, f) => s + f.winE2, 0) };
}

export interface SlotAnalysis {
  /** Exact RTP = rtpNum / rtpDen (multiples of the stake). */
  rtpNum: bigint;
  rtpDen: bigint;
  rtp: number;
  /** Mean and variance of one spin's win, hundredths of the stake. */
  spinMeanE2: number;
  spinVarE2: number;
  /** Mean and variance of a whole round's win, hundredths of the stake. */
  meanE2: number;
  varE2: number;
  /** Exact largest round win, hundredths of the stake. */
  maxTotalE2: number;
  maxSpinE2: number;
  /** P(free spins are awarded). */
  triggerProbability: number;
  /** Share of the RTP paid by free spins. */
  freeSpinsShare: number;
  /** Probability that a spin wins anything. */
  hitFrequency: number;
}

const cache = new Map<string, SlotAnalysis>();

interface ReelWindow {
  /** Counts per paying symbol (wilds included). */
  counts: number[];
  scatters: number;
  /** Number of stops that show this window. */
  weight: number;
}

function reelWindows(config: SlotConfig, r: Roles): ReelWindow[][] {
  return config.reels.map((strip) => {
    const groups = new Map<string, ReelWindow>();
    for (let stop = 0; stop < strip.length; stop += 1) {
      const w = windowAt(strip, stop);
      const counts = r.paying.map((p) => w.filter((x) => x === p.id || x === r.wild).length);
      const scatters = w.filter((x) => x === r.scatter).length;
      const k = `${counts.join(',')}|${scatters}`;
      const g = groups.get(k);
      if (g) g.weight += 1;
      else groups.set(k, { counts, scatters, weight: 1 });
    }
    return [...groups.values()];
  });
}

/**
 * A spin's win is a sum of terms pay(s, k) · ∏ᵢ φᵢ(window on reel i), one per
 * paying symbol s and run length k, where φᵢ is the count of s (or wild) for
 * i < k, [no s or wild] for i = k < 5, and 1 after. Reels are independent, so
 * the expectation of any product of such terms factorises over reels.
 */
interface Term {
  pay: number;
  sym: number;
  run: number;
}

function phi(t: Term, reel: number, w: ReelWindow): number {
  const c = w.counts[t.sym]!;
  if (reel < t.run) return c;
  if (reel === t.run) return c === 0 ? 1 : 0;
  return 1;
}

/** Polynomial helpers (coefficients indexed by scatter count). */
const polyMul = (a: number[], b: number[]) => {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j]! += x * y)));
  return out;
};

/**
 * Exact analysis. Moments factorise over reels (see Term); the exact RTP
 * fraction uses integer arithmetic; the maximum and the hit frequency come
 * from exact depth-first searches over windows with pruning.
 */
export function analyseMachine(config: SlotConfig): SlotAnalysis {
  const key = JSON.stringify(config);
  const hit = cache.get(key);
  if (hit) return hit;
  const r = roles(config);
  const windows = reelWindows(config, r);
  const lengths = config.reels.map((s) => s.length);
  const total = lengths.reduce((a, b) => a * b, 1);
  const terms: Term[] = [];
  r.paying.forEach((p, sym) => {
    for (let run = SLOT_MIN_RUN; run <= SLOT_REELS; run += 1) {
      const pay = p.pays[run - SLOT_MIN_RUN]!;
      if (pay > 0) terms.push({ pay, sym, run });
    }
  });

  // E[φ] per term per reel as integer sums over stops (exact).
  const sumPhi = terms.map((t) => windows.map((ws, i) => ws.reduce((s, w) => s + w.weight * phi(t, i, w), 0)));
  // Exact ΣB over all stop combinations: Σ_terms pay · ∏ᵢ Σ_stops φᵢ.
  const sumB = terms.reduce((acc, t, ti) => acc + BigInt(t.pay) * sumPhi[ti]!.reduce((p, x) => p * BigInt(x), 1n), 0n);

  // Scatter-count distribution and E[B·1{Z=n}] via per-reel polynomials.
  const scatterPoly = windows.map((ws) => {
    const poly = new Array<number>(SLOT_ROWS + 1).fill(0);
    for (const w of ws) poly[w.scatters]! += w.weight;
    return poly;
  });
  const countZ = scatterPoly.reduce((a, b) => polyMul(a, b), [1]); // integer weights by Z
  const bByZ = new Array<number>(countZ.length).fill(0);
  terms.forEach((t) => {
    const poly = windows
      .map((ws, i) => {
        const p = new Array<number>(SLOT_ROWS + 1).fill(0);
        for (const w of ws) p[w.scatters]! += w.weight * phi(t, i, w);
        return p;
      })
      .reduce((a, b) => polyMul(a, b), [1]);
    poly.forEach((x, z) => (bByZ[z]! += t.pay * x));
  });

  // Second moment: Σ over term pairs of pay·pay'·∏ᵢ E[φ φ'].
  let sumB2 = 0;
  for (let a = 0; a < terms.length; a += 1) {
    for (let b = a; b < terms.length; b += 1) {
      let prod = terms[a]!.pay * terms[b]!.pay;
      for (let i = 0; i < SLOT_REELS && prod !== 0; i += 1) {
        let e = 0;
        for (const w of windows[i]!) e += w.weight * phi(terms[a]!, i, w) * phi(terms[b]!, i, w);
        prod *= e / lengths[i]!;
      }
      sumB2 += (a === b ? 1 : 2) * prod;
    }
  }

  const m = config.freeSpins.multiplier;
  const mu = Number(sumB) / total;
  const eB2 = sumB2;
  const varB = Math.max(0, eB2 - mu * mu);
  let fsMeanTerm = 0;
  let cross = 0;
  let fsSecond = 0;
  let pTrig = 0;
  let awardWeight = 0n;
  countZ.forEach((cz, z) => {
    const n = awardFor(config, z);
    if (n === 0 || cz === 0) return;
    const p = cz / total;
    pTrig += p;
    fsMeanTerm += p * n * m * mu;
    cross += (bByZ[z]! / total) * n * m * mu;
    fsSecond += p * m * m * (n * varB + n * n * mu * mu);
    awardWeight += BigInt(cz) * BigInt(n);
  });
  const mean = mu + fsMeanTerm;
  const second = eB2 + 2 * cross + fsSecond;
  const T = BigInt(total);
  const rtpNum = sumB * (T + BigInt(m) * awardWeight);
  const rtpDen = 100n * T * T;

  const maxSpin = maxWin(r, windows, () => 0);
  const maxTotal = maxWin(r, windows, (z) => awardFor(config, z) * m * maxSpin);

  const hits = winningWeight(r, windows, lengths);

  const result: SlotAnalysis = {
    rtpNum,
    rtpDen,
    rtp: Number((rtpNum * 1_000_000_000n) / rtpDen) / 1e9,
    spinMeanE2: mu,
    spinVarE2: varB,
    meanE2: mean,
    varE2: Math.max(0, second - mean * mean),
    maxTotalE2: maxTotal,
    maxSpinE2: maxSpin,
    triggerProbability: pTrig,
    freeSpinsShare: mean > 0 ? fsMeanTerm / mean : 0,
    hitFrequency: hits / total,
  };
  cache.set(key, result);
  return result;
}

/**
 * Exact number of stop combinations whose spin pays anything, by depth-first
 * search over windows. A branch is counted whole as soon as a win is certain
 * (a run ended with a positive pay, or a symbol still running already has a
 * positive pay for its current length, which a longer run never lowers), and
 * dropped as soon as no symbol can still produce a pay.
 */
function winningWeight(r: Roles, windows: ReelWindow[][], lengths: number[]): number {
  const S = r.paying.length;
  const tail = Array.from({ length: SLOT_REELS + 1 }, (_, i) => lengths.slice(i).reduce((a, b) => a * b, 1));
  const alive = Array.from({ length: SLOT_REELS + 1 }, () => new Int8Array(S));
  alive[0]!.fill(1);
  let total = 0;
  const walk = (d: number, weight: number) => {
    // A symbol alive after d reels with d ≥ 3 and a positive pay for d reels pays at least that
    // (pays never fall with a longer run), so the spin wins whatever the remaining reels show.
    let possible = false;
    for (let s = 0; s < S; s += 1) {
      if (!alive[d]![s]) continue;
      if (d >= SLOT_MIN_RUN && r.paying[s]!.pays[d - SLOT_MIN_RUN]! > 0) {
        total += weight * tail[d]!;
        return;
      }
      if (r.paying[s]!.pays[2] > 0) possible = true;
    }
    if (!possible || d === SLOT_REELS) return;
    for (const w of windows[d]!) {
      let won = false;
      for (let s = 0; s < S; s += 1) {
        if (!alive[d]![s]) {
          alive[d + 1]![s] = 0;
          continue;
        }
        const c = w.counts[s]!;
        alive[d + 1]![s] = c > 0 ? 1 : 0;
        if (c === 0 && d >= SLOT_MIN_RUN && r.paying[s]!.pays[d - SLOT_MIN_RUN]! > 0) won = true;
      }
      if (won) total += weight * w.weight * tail[d + 1]!;
      else walk(d + 1, weight * w.weight);
    }
  };
  walk(0, 1);
  return total;
}

/**
 * Exact maximum over all stop combinations of (spin win + bonus(Z)), by
 * depth-first search with an admissible bound: a symbol still running can at
 * best continue to reel 5 at the largest count each remaining reel offers
 * (pays never fall with a longer run), and the scatters at best reach the
 * largest count the remaining reels offer.
 */
function maxWin(r: Roles, windows: ReelWindow[][], bonus: (scatters: number) => number): number {
  const S = r.paying.length;
  const maxCount = windows.map((ws) => Array.from({ length: S }, (_, s) => Math.max(...ws.map((w) => w.counts[s]!))));
  const maxScat = windows.map((ws) => Math.max(...ws.map((w) => w.scatters)));
  // Best product of counts from reel i to the end, per symbol.
  const tailCount = Array.from({ length: SLOT_REELS + 1 }, (_, i) => Array.from({ length: S }, (_, s) => maxCount.slice(i).reduce((p, c) => p * Math.max(1, c[s]!), 1)));
  const tailScat = Array.from({ length: SLOT_REELS + 1 }, (_, i) => maxScat.slice(i).reduce((a, b) => a + b, 0));
  const pay5 = r.paying.map((p) => p.pays[2]);
  let best = 0;
  const alive = Array.from({ length: SLOT_REELS + 1 }, () => new Int8Array(S));
  const prod = Array.from({ length: SLOT_REELS + 1 }, () => new Float64Array(S));
  alive[0]!.fill(1);
  prod[0]!.fill(1);
  const walk = (d: number, banked: number, z: number) => {
    // Bound for this node.
    let bound = banked + bonus(z + tailScat[d]!);
    for (let s = 0; s < S; s += 1) if (alive[d]![s]) bound += pay5[s]! * prod[d]![s]! * tailCount[d]![s]!;
    if (bound <= best) return;
    if (d === SLOT_REELS) {
      let b = banked;
      for (let s = 0; s < S; s += 1) if (alive[d]![s]) b += pay5[s]! * prod[d]![s]!;
      best = Math.max(best, b + bonus(z));
      return;
    }
    for (const w of windows[d]!) {
      let bank = banked;
      for (let s = 0; s < S; s += 1) {
        if (!alive[d]![s]) {
          alive[d + 1]![s] = 0;
          continue;
        }
        const c = w.counts[s]!;
        if (c === 0) {
          alive[d + 1]![s] = 0;
          if (d >= SLOT_MIN_RUN) bank += r.paying[s]!.pays[d - SLOT_MIN_RUN]! * prod[d]![s]!;
        } else {
          alive[d + 1]![s] = 1;
          prod[d + 1]![s] = prod[d]![s]! * c;
        }
      }
      walk(d + 1, bank, z + w.scatters);
    }
  };
  walk(0, 0, 0);
  return best;
}

function risk(config: SlotConfig, amount: number): RiskProfile {
  const a = analyseMachine(config);
  return {
    stake: amount,
    maxPayout: mulDivFloor(amount, a.maxTotalE2, 100),
    expectedPayout: (amount * a.meanE2) / 100,
    payoutVariance: (amount * amount * a.varE2) / 10_000,
  };
}

/** Builds the game module for one machine (its id, name and default reels). */
export function slotModule(id: GameId, name: string, defaultConfig: SlotConfig): GameModule<SlotConfig, SlotBet, SlotState, never, SlotState> {
  return {
    id,
    name,
    interactive: false,
    configSchema: slotConfigSchema,
    defaultConfig,
    betSchema: slotBetSchema,
    actionSchema: null,

    assess(config, bet) {
      return risk(config, bet.amount);
    },

    wagers(_config, bet) {
      return [{ kind: 'MAIN', amount: bet.amount }];
    },

    start(config, bet, rng) {
      if (!Number.isSafeInteger(bet.amount) || bet.amount <= 0) throw new GameRuleError('INVALID_STAKE', 'Invalid stake');
      const r = playSlotRound(config, rng);
      const payout = mulDivFloor(bet.amount, r.totalE2, 100);
      const state: SlotState = { amount: bet.amount, base: r.base, freeSpins: r.freeSpins, multiplier: config.freeSpins.multiplier, totalE2: r.totalE2, payout };
      return settled(state, payout, risk(config, bet.amount));
    },

    act() {
      return notInteractive(id);
    },

    expire() {
      return null;
    },

    expiresAfterMs() {
      return null; // Settles instantly, free spins included.
    },

    view(_config, state) {
      return state;
    },

    theoretical(config) {
      const a = analyseMachine(config);
      return {
        rtp: a.rtp,
        houseEdge: 1 - a.rtp,
        method: 'exact',
        notes: `Exact, by enumerating every combination of reel stops. Free spins (${(a.triggerProbability * 100).toFixed(3)}% of spins) contribute ${(a.freeSpinsShare * 100).toFixed(1)}% of the return. Largest possible win: ${(a.maxTotalE2 / 100).toLocaleString('en-US')}× the stake.`,
      };
    },
  };
}
