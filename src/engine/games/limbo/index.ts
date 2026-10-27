/**
 * Limbo (instant, server-authoritative).
 *
 * The player picks a target multiplier T (hundredths, e.g. 200 = 2.00×). The
 * server draws a result multiplier R with exactly the Crash distribution
 * (same provably fair mapping, src/engine/games/crash):
 *   R = max(1.00, ⌊100 · (10000 − h) · 2⁵² / (10000 · (2⁵² − n))⌋ / 100),  n uniform on [0, 2⁵²)
 * The player wins ⌊stake · T⌋ when R ≥ T (a tie wins), otherwise nothing.
 *
 * Exactly: P(R ≥ T) = ⌊(10000 − h) · 2⁵² / (100 · T)⌋ / 2⁵², so
 *   RTP(T) = P(R ≥ T) · T = (1 − h) − (fraction below one part in 2⁵²) ≤ 1 − h
 * for every target. The displayed result is R itself; the target only
 * decides whether the round pays.
 */
import { z } from 'zod';
import { MAX_MULTIPLIER, mulDivFloor } from '../../money';
import type { RandomSource } from '../../rng/provably-fair';
import { drawCrashPoint } from '../crash';
import { stakeSchema } from '../shared';
import { GameRuleError, notInteractive, settled, type GameModule, type RiskProfile } from '../types';

const TWO_52 = 2n ** 52n;

export const limboConfigSchema = z
  .object({
    houseEdgeBp: z.int().min(1).max(2000),
    /** Smallest target in hundredths (101 = 1.01×). */
    minTargetE2: z.int().min(101),
    /** Largest target in hundredths (1_000_000 = 10,000×). */
    maxTargetE2: z.int().max(MAX_MULTIPLIER * 100),
  })
  .refine((c) => c.minTargetE2 < c.maxTargetE2, { message: 'minTargetE2 must be below maxTargetE2' });
export type LimboConfig = z.infer<typeof limboConfigSchema>;

export const limboBetSchema = z
  .object({
    amount: stakeSchema,
    /** Target multiplier in hundredths. */
    targetE2: z.int().min(101).max(MAX_MULTIPLIER * 100),
  })
  .strict();
export type LimboBet = z.infer<typeof limboBetSchema>;

export interface LimboState {
  amount: number;
  targetE2: number;
  /** The drawn multiplier in hundredths (100 = 1.00×). */
  resultE2: number;
  won: boolean;
  payout: number;
}

/** Exact P(R ≥ T) as a fraction of 2⁵² (numerator). */
export function limboWinNumerator(targetE2: number, houseEdgeBp: number): bigint {
  const count = (BigInt(10_000 - houseEdgeBp) * TWO_52) / (100n * BigInt(targetE2));
  return count < TWO_52 ? count : TWO_52;
}

/** P(R ≥ T) as a float (exact to double precision). */
export function limboWinProbability(targetE2: number, houseEdgeBp: number): number {
  return Number(limboWinNumerator(targetE2, houseEdgeBp)) / 2 ** 52;
}

function quote(config: LimboConfig, bet: LimboBet) {
  if (bet.targetE2 < config.minTargetE2 || bet.targetE2 > config.maxTargetE2) {
    throw new GameRuleError(
      'TARGET_OUT_OF_RANGE',
      `Target must be between ${(config.minTargetE2 / 100).toFixed(2)}× and ${(config.maxTargetE2 / 100).toFixed(2)}×`,
      { minTargetE2: config.minTargetE2, maxTargetE2: config.maxTargetE2 },
    );
  }
  const winPayout = mulDivFloor(bet.amount, bet.targetE2, 100);
  const p = limboWinProbability(bet.targetE2, config.houseEdgeBp);
  const risk: RiskProfile = { stake: bet.amount, maxPayout: winPayout, expectedPayout: winPayout * p, payoutVariance: winPayout * winPayout * p * (1 - p) };
  return { winPayout, risk };
}

export const limbo: GameModule<LimboConfig, LimboBet, LimboState, never, LimboState> = {
  id: 'limbo',
  name: 'Limbo',
  interactive: false,
  configSchema: limboConfigSchema,
  defaultConfig: { houseEdgeBp: 100, minTargetE2: 101, maxTargetE2: 1_000_000 },
  betSchema: limboBetSchema,
  actionSchema: null,

  assess(config, bet) {
    return quote(config, bet).risk;
  },

  wagers(_config, bet) {
    return [{ kind: 'MAIN', amount: bet.amount, selection: { targetE2: bet.targetE2 } }];
  },

  start(config, bet, rng: RandomSource) {
    const q = quote(config, bet);
    const resultE2 = drawCrashPoint(rng, config.houseEdgeBp);
    const won = resultE2 >= bet.targetE2;
    const payout = won ? q.winPayout : 0;
    return settled({ amount: bet.amount, targetE2: bet.targetE2, resultE2, won, payout }, payout, q.risk);
  },

  act() {
    return notInteractive('limbo');
  },

  expire() {
    return null;
  },

  expiresAfterMs() {
    return null; // Settles instantly.
  },

  view(_config, state) {
    return state;
  },

  theoretical(config) {
    const edge = config.houseEdgeBp / 10_000;
    return {
      rtp: 1 - edge,
      houseEdge: edge,
      method: 'exact',
      notes: `Every target T returns T × P(result ≥ T) = ${((1 - edge) * 100).toFixed(2)}% (less than one part in 2⁵² lower, from the exact integer mapping).`,
    };
  },
};
