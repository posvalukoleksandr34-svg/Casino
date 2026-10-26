/**
 * Dice: the server draws a uniform integer roll in [0, 9999], displayed as
 * 0.00–99.99. The player picks a target and a direction:
 *   under: wins when roll <  target          → winCount = target
 *   over:  wins when roll >  target          → winCount = 9999 − target
 * Payout multiplier (4 decimal places, rounded down):
 *   multiplierE4 = floor((10000 − houseEdgeBp) · 10000 / winCount)
 *   gross payout = floor(stake · multiplierE4 / 10000)
 * so RTP = (winCount / 10000) · (multiplierE4 / 10000) ≤ 1 − houseEdge.
 */
import { z } from 'zod';
import { mulDivFloor } from '../../money';
import type { RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { GameRuleError, notInteractive, settled, type GameModule, type RiskProfile } from '../types';

export const DICE_OUTCOMES = 10_000;

export const diceConfigSchema = z
  .object({
    /** House edge in basis points (100 = 1%). Must be strictly positive. */
    houseEdgeBp: z.int().min(1).max(2000),
    /** Smallest allowed number of winning rolls (100 = 1% win chance). */
    minWinCount: z.int().min(1).max(9998),
    /** Largest allowed number of winning rolls (9800 = 98% win chance). */
    maxWinCount: z.int().min(2).max(9999),
  })
  .refine((c) => c.minWinCount < c.maxWinCount, { message: 'minWinCount must be below maxWinCount' });
export type DiceConfig = z.infer<typeof diceConfigSchema>;

export const diceBetSchema = z
  .object({
    amount: stakeSchema,
    /** Target in hundredths (e.g. 4950 = 49.50). */
    target: z.int().min(1).max(9998),
    direction: z.enum(['under', 'over']),
  })
  .strict();
export type DiceBet = z.infer<typeof diceBetSchema>;

export interface DiceState {
  amount: number;
  target: number;
  direction: 'under' | 'over';
  winCount: number;
  multiplierE4: number;
  roll: number;
  won: boolean;
  payout: number;
}

export function winCountFor(target: number, direction: 'under' | 'over'): number {
  return direction === 'under' ? target : DICE_OUTCOMES - 1 - target;
}

export function multiplierE4For(winCount: number, houseEdgeBp: number): number {
  if (winCount <= 0 || winCount >= DICE_OUTCOMES) throw new RangeError('winCount out of range');
  return Math.floor(((10_000 - houseEdgeBp) * 10_000) / winCount);
}

export function diceWins(roll: number, target: number, direction: 'under' | 'over'): boolean {
  return direction === 'under' ? roll < target : roll > target;
}

/** Exact theoretical RTP for a given win count (excludes the < 1 minor unit payout floor). */
export function diceRtp(winCount: number, houseEdgeBp: number): number {
  return (winCount / DICE_OUTCOMES) * (multiplierE4For(winCount, houseEdgeBp) / 10_000);
}

function quote(config: DiceConfig, bet: DiceBet) {
  const winCount = winCountFor(bet.target, bet.direction);
  if (winCount < config.minWinCount || winCount > config.maxWinCount) {
    throw new GameRuleError(
      'WIN_CHANCE_OUT_OF_RANGE',
      `Win chance must be between ${(config.minWinCount / 100).toFixed(2)}% and ${(config.maxWinCount / 100).toFixed(2)}%`,
      { minWinCount: config.minWinCount, maxWinCount: config.maxWinCount, winCount },
    );
  }
  const multiplierE4 = multiplierE4For(winCount, config.houseEdgeBp);
  const winPayout = mulDivFloor(bet.amount, multiplierE4, 10_000);
  const p = winCount / DICE_OUTCOMES;
  const risk: RiskProfile = {
    stake: bet.amount,
    maxPayout: winPayout,
    expectedPayout: winPayout * p,
    payoutVariance: winPayout * winPayout * p * (1 - p),
  };
  return { winCount, multiplierE4, winPayout, risk };
}

export const dice: GameModule<DiceConfig, DiceBet, DiceState, never, DiceState> = {
  id: 'dice',
  name: 'Dice',
  interactive: false,
  configSchema: diceConfigSchema,
  defaultConfig: { houseEdgeBp: 100, minWinCount: 100, maxWinCount: 9800 },
  betSchema: diceBetSchema,
  actionSchema: null,

  assess(config, bet) {
    return quote(config, bet).risk;
  },

  wagers(_config, bet) {
    return [{ kind: 'MAIN', amount: bet.amount, selection: { target: bet.target, direction: bet.direction } }];
  },

  start(config, bet, rng: RandomSource) {
    const q = quote(config, bet);
    const roll = rng.nextInt(DICE_OUTCOMES);
    const won = diceWins(roll, bet.target, bet.direction);
    const payout = won ? q.winPayout : 0;
    return settled(
      {
        amount: bet.amount,
        target: bet.target,
        direction: bet.direction,
        winCount: q.winCount,
        multiplierE4: q.multiplierE4,
        roll,
        won,
        payout,
      },
      payout,
      q.risk,
    );
  },

  act() {
    return notInteractive('dice');
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
      notes: `RTP is at most ${((1 - edge) * 100).toFixed(2)}% for every target; the multiplier is rounded down to 4 decimals, which lowers RTP by less than 0.01 percentage points.`,
    };
  },
};
