/**
 * Crash (single-player, server-authoritative).
 *
 * Crash point. From the provably fair stream take n = 52 random bits
 * (u = n / 2⁵²). With house edge h (basis points), in exact integer arithmetic:
 *   crashE2 = max(100, ⌊ 100 · (10000 − h) · 2⁵² / (10000 · (2⁵² − n)) ⌋)
 * so for any target x ≥ 1.01: P(crash ≥ x) = (1 − h)/x. A crash point below
 * 1.01× ends the round at take-off: P(crash = 1.00×) = 1 − (1 − h)/1.01
 * (≈1.98% with h = 1%).
 *
 * Flight. The multiplier shown at server time t after the round starts is
 * ⌊100 · e^{r·t}⌋ / 100. The round ends at t(crash) = ln(crash)/r. A cash-out
 * at multiplier c succeeds iff it happens before the crash; an automatic
 * cash-out target A succeeds iff A ≤ crash; reaching the cap C pays C.
 * Every target therefore has RTP = x · (1 − h)/x = 1 − h.
 */
import { z } from 'zod';
import { mulDivFloor } from '../../money';
import type { RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { GameRuleError, settled, type GameModule, type RiskProfile, type StepResult } from '../types';

const TWO_52 = 2n ** 52n;

export const crashConfigSchema = z.object({
  houseEdgeBp: z.int().min(1).max(2000),
  /** Growth rate per millisecond: 6e-5 doubles every ≈11.6 s. */
  growthPerMs: z.number().positive().max(0.01),
  /** Multiplier cap in hundredths (100_000 = 1,000×). */
  maxMultiplierE2: z.int().min(200).max(10_000_000),
});
export type CrashConfig = z.infer<typeof crashConfigSchema>;

export const crashBetSchema = z
  .object({
    amount: stakeSchema,
    /** Optional automatic cash-out target in hundredths (e.g. 200 = 2.00×). */
    autoCashoutE2: z.int().min(101).max(10_000_000).optional(),
  })
  .strict();
export type CrashBet = z.infer<typeof crashBetSchema>;

export const crashActionSchema = z.object({ type: z.literal('cashout') }).strict();
export type CrashAction = z.infer<typeof crashActionSchema>;

export interface CrashState {
  amount: number;
  autoCashoutE2: number | null;
  /** Secret while the round is open. */
  crashE2: number;
  capE2: number;
  growthPerMs: number;
  status: 'flying' | 'cashed' | 'busted';
  cashedOutE2: number | null;
  /** Server time offset (ms after start) at which the round ended. */
  endedAtMs: number | null;
  payout: number;
}

export interface CrashView extends Omit<CrashState, 'crashE2'> {
  crashE2: number | null;
}

/** Exact crash point from 52 random bits. */
export function crashPointFromBits(n: bigint, houseEdgeBp: number): number {
  const num = 100n * BigInt(10_000 - houseEdgeBp) * TWO_52;
  const den = 10_000n * (TWO_52 - n);
  const raw = num / den;
  return Number(raw < 100n ? 100n : raw > 1_000_000_000n ? 1_000_000_000n : raw);
}

export function drawCrashPoint(rng: RandomSource, houseEdgeBp: number): number {
  const hi = BigInt(rng.nextUint32() >>> 12); // 20 bits
  const lo = BigInt(rng.nextUint32()); // 32 bits
  return crashPointFromBits((hi << 32n) | lo, houseEdgeBp);
}

/** P(crash ≥ x) for x in hundredths (x ≥ 101). */
export function survivalAt(xE2: number, houseEdgeBp: number): number {
  return Math.min(1, ((10_000 - houseEdgeBp) / 10_000) / (xE2 / 100));
}

export function multiplierAt(elapsedMs: number, growthPerMs: number): number {
  return Math.floor(100 * Math.exp(growthPerMs * Math.max(0, elapsedMs)));
}

export function timeToReach(xE2: number, growthPerMs: number): number {
  return Math.log(xE2 / 100) / growthPerMs;
}

function targetRisk(amount: number, targetE2: number, houseEdgeBp: number): Pick<RiskProfile, 'expectedPayout' | 'payoutVariance'> {
  const win = mulDivFloor(amount, targetE2, 100);
  const p = survivalAt(targetE2, houseEdgeBp);
  return { expectedPayout: win * p, payoutVariance: win * win * p * (1 - p) };
}

/**
 * Max payout is the automatic target or the cap. Manual play is
 * strategy-dependent, so analytics use the realised cash-out multiplier (or
 * 2.00× when unknown) as the reference target — a documented approximation.
 */
function riskWithEdge(config: CrashConfig, s: Pick<CrashState, 'amount' | 'autoCashoutE2' | 'capE2'>, strategyE2?: number): RiskProfile {
  const top = s.autoCashoutE2 ?? s.capE2;
  const strat = Math.max(101, strategyE2 ?? s.autoCashoutE2 ?? 200);
  return { stake: s.amount, maxPayout: mulDivFloor(s.amount, top, 100), ...targetRisk(s.amount, strat, config.houseEdgeBp) };
}

function assessBet(config: CrashConfig, bet: CrashBet): RiskProfile {
  if (bet.autoCashoutE2 !== undefined && bet.autoCashoutE2 > config.maxMultiplierE2) {
    throw new GameRuleError('AUTO_CASHOUT_TOO_HIGH', `Automatic cash-out cannot exceed ${(config.maxMultiplierE2 / 100).toFixed(2)}×`);
  }
  return riskWithEdge(config, { amount: bet.amount, autoCashoutE2: bet.autoCashoutE2 ?? null, capE2: config.maxMultiplierE2 });
}

function end(config: CrashConfig, s: CrashState, status: 'cashed' | 'busted', atE2: number | null, endedAtMs: number): StepResult<CrashState> {
  const payout = status === 'cashed' && atE2 !== null ? mulDivFloor(s.amount, atE2, 100) : 0;
  const next: CrashState = { ...s, status, cashedOutE2: atE2, endedAtMs: Math.round(endedAtMs), payout };
  return settled(next, payout, riskWithEdge(config, next, atE2 ?? s.autoCashoutE2 ?? 200));
}

/**
 * Elapsed ms at which the flight is decided by time alone: the automatic
 * target (if reached before the crash), the cap, or the crash. Rounded up to
 * a whole millisecond so that `resolveByTime` is guaranteed to settle at it.
 */
export function flightEndMs(s: Pick<CrashState, 'crashE2' | 'autoCashoutE2' | 'capE2' | 'growthPerMs'>): number {
  const r = s.growthPerMs;
  if (s.autoCashoutE2 !== null && s.autoCashoutE2 <= s.crashE2) return Math.ceil(timeToReach(s.autoCashoutE2, r));
  if (s.crashE2 >= s.capE2) return Math.ceil(timeToReach(s.capE2, r));
  return Math.ceil(timeToReach(s.crashE2, r));
}

/** Settles whatever has already happened by `elapsedMs` (auto cash-out, cap or crash), or null. */
function resolveByTime(config: CrashConfig, s: CrashState, elapsedMs: number): StepResult<CrashState> | null {
  const r = s.growthPerMs;
  const tCrash = timeToReach(s.crashE2, r);
  if (s.autoCashoutE2 !== null && s.autoCashoutE2 <= s.crashE2) {
    const tAuto = timeToReach(s.autoCashoutE2, r);
    if (elapsedMs >= tAuto) return end(config, s, 'cashed', s.autoCashoutE2, tAuto);
    return null;
  }
  if (s.crashE2 >= s.capE2) {
    const tCap = timeToReach(s.capE2, r);
    if (elapsedMs >= tCap) return end(config, s, 'cashed', s.capE2, tCap);
    return null;
  }
  if (elapsedMs >= tCrash) return end(config, s, 'busted', null, tCrash);
  return null;
}

export const crash: GameModule<CrashConfig, CrashBet, CrashState, CrashAction, CrashView> = {
  id: 'crash',
  name: 'Crash',
  interactive: true,
  configSchema: crashConfigSchema,
  defaultConfig: { houseEdgeBp: 100, growthPerMs: 0.00006, maxMultiplierE2: 100_000 },
  betSchema: crashBetSchema,
  actionSchema: crashActionSchema,

  assess(config, bet) {
    return assessBet(config, bet);
  },

  wagers(_config, bet) {
    return [{ kind: 'MAIN', amount: bet.amount, selection: { autoCashoutE2: bet.autoCashoutE2 ?? null } }];
  },

  start(config, bet, rng: RandomSource) {
    const risk = assessBet(config, bet);
    const state: CrashState = {
      amount: bet.amount,
      autoCashoutE2: bet.autoCashoutE2 ?? null,
      crashE2: drawCrashPoint(rng, config.houseEdgeBp),
      capE2: config.maxMultiplierE2,
      growthPerMs: config.growthPerMs,
      status: 'flying',
      cashedOutE2: null,
      endedAtMs: null,
      payout: 0,
    };
    // An immediate bust (crash point 1.00×) settles straight away.
    const immediate = resolveByTime(config, state, 0);
    return immediate ?? { state, status: 'OPEN', payout: 0, additionalStakes: [], risk };
  },

  act(config, state, _action, ctx) {
    if (state.status !== 'flying') throw new GameRuleError('ROUND_FINISHED', 'This round has finished');
    const already = resolveByTime(config, state, ctx.elapsedMs);
    if (already) return already;
    // Still flying: cash out at the current multiplier, which is strictly below
    // the crash point, the cap and any automatic target (they have not been reached).
    const limit = Math.min(state.crashE2, state.capE2, state.autoCashoutE2 ?? Number.MAX_SAFE_INTEGER) - 1;
    const at = Math.max(100, Math.min(multiplierAt(ctx.elapsedMs, state.growthPerMs), limit));
    return end(config, state, 'cashed', at, ctx.elapsedMs);
  },

  expire(config, state, ctx) {
    if (state.status !== 'flying') return null;
    return resolveByTime(config, state, ctx.elapsedMs);
  },

  expiresAfterMs(_config, state) {
    return state.status === 'flying' ? flightEndMs(state) : null;
  },

  view(_config, state, isFinal) {
    return { ...state, crashE2: isFinal || state.status !== 'flying' ? state.crashE2 : null };
  },

  theoretical(config) {
    const edge = config.houseEdgeBp / 10_000;
    return {
      rtp: 1 - edge,
      houseEdge: edge,
      method: 'exact',
      notes: `Any cash-out target x ≥ 1.01× returns x × P(crash ≥ x) = ${((1 - edge) * 100).toFixed(2)}% on average. ${((1 - (1 - edge) / 1.01) * 100).toFixed(2)}% of rounds crash at take-off (1.00×). Manual cash-outs are timed by the server clock.`,
    };
  },
};
