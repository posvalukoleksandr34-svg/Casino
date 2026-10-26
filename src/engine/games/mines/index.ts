/**
 * Mines: a 5×5 grid hides m mines (1 ≤ m ≤ 24), placed by a provably fair
 * Fisher–Yates shuffle when the round starts. The player reveals tiles one at
 * a time and may cash out after any safe reveal.
 *
 * After k safe reveals the probability of having survived is
 *   P(k) = C(25 − m, k) / C(25, k)
 * and the offered multiplier is (1 − edge) / P(k), rounded down to 4 decimals:
 *   multiplierE4(k) = ⌊(10000 − edgeBp) · C(25, k) / C(25 − m, k)⌋
 * capped at maxMultiplierE4 (the round auto-settles when the cap is reached).
 * Every stopping strategy therefore has RTP ≤ 1 − edge.
 */
import { z } from 'zod';
import { binomial } from '../../combinatorics';
import { mulDivFloor } from '../../money';
import { shuffle, type RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { GameRuleError, settled, type GameModule, type RiskProfile, type StepResult } from '../types';

export const MINES_TILES = 25;

export const minesConfigSchema = z
  .object({
    houseEdgeBp: z.int().min(1).max(2000),
    minMines: z.int().min(1).max(24),
    maxMines: z.int().min(1).max(24),
    /** Multiplier cap ×10⁴ (e.g. 100_000_000 = 10,000×). */
    maxMultiplierE4: z.int().min(20_000).max(1_000_000_000),
  })
  .refine((c) => c.minMines <= c.maxMines, { message: 'minMines must not exceed maxMines' });
export type MinesConfig = z.infer<typeof minesConfigSchema>;

export const minesBetSchema = z.object({ amount: stakeSchema, mines: z.int().min(1).max(24) }).strict();
export type MinesBet = z.infer<typeof minesBetSchema>;

export const minesActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reveal'), tile: z.int().min(0).max(MINES_TILES - 1) }).strict(),
  z.object({ type: z.literal('cashout') }).strict(),
]);
export type MinesAction = z.infer<typeof minesActionSchema>;

export interface MinesState {
  amount: number;
  mineCount: number;
  /** Secret while the round is open. */
  mines: number[];
  revealed: number[];
  multiplierE4: number;
  status: 'playing' | 'busted' | 'cashed';
  hitMine: number | null;
  payout: number;
}

export interface MinesView extends Omit<MinesState, 'mines'> {
  mines: number[] | null;
  nextMultiplierE4: number | null;
  nextSafeProbability: number | null;
  maxPicks: number;
}

/** P(all of the first k picks are safe). */
export function survivalProbability(mines: number, k: number): number {
  return Number(binomial(MINES_TILES - mines, k)) / Number(binomial(MINES_TILES, k));
}

export function multiplierE4(config: MinesConfig, mines: number, k: number): number {
  if (k === 0) return 10_000;
  const num = BigInt(10_000 - config.houseEdgeBp) * binomial(MINES_TILES, k);
  const den = binomial(MINES_TILES - mines, k);
  const m = num / den;
  return Number(m > BigInt(config.maxMultiplierE4) ? BigInt(config.maxMultiplierE4) : m);
}

/** The largest number of picks a round can reach before it settles (all safe tiles, or the cap). */
export function maxPicks(config: MinesConfig, mines: number): number {
  const safe = MINES_TILES - mines;
  for (let k = 1; k <= safe; k += 1) if (multiplierE4(config, mines, k) >= config.maxMultiplierE4) return k;
  return safe;
}

/** RTP of the strategy "cash out after exactly k safe picks" (exact up to the 4-decimal floor). */
export function strategyRtp(config: MinesConfig, mines: number, k: number): number {
  return survivalProbability(mines, k) * (multiplierE4(config, mines, k) / 10_000);
}

function riskFor(config: MinesConfig, s: Pick<MinesState, 'amount' | 'mineCount' | 'revealed'>, settledPayout?: number): RiskProfile {
  const top = maxPicks(config, s.mineCount);
  const maxPayout = settledPayout ?? mulDivFloor(s.amount, multiplierE4(config, s.mineCount, top), 10_000);
  // Strategy-dependent game: expectation/variance are reported for the strategy
  // "cash out after the next pick" from the current position (documented approximation).
  const k = Math.min(top, Math.max(1, s.revealed.length + (settledPayout === undefined ? 1 : 0)));
  const p = survivalProbability(s.mineCount, k);
  const win = mulDivFloor(s.amount, multiplierE4(config, s.mineCount, k), 10_000);
  return {
    stake: s.amount,
    maxPayout,
    expectedPayout: win * p,
    payoutVariance: win * win * p * (1 - p),
  };
}

function validate(config: MinesConfig, bet: MinesBet): void {
  if (bet.mines < config.minMines || bet.mines > config.maxMines) {
    throw new GameRuleError('MINES_OUT_OF_RANGE', `Choose between ${config.minMines} and ${config.maxMines} mines`);
  }
}

function finish(config: MinesConfig, state: MinesState): StepResult<MinesState> {
  return settled(state, state.payout, { ...riskFor(config, state, state.payout) });
}

export const mines: GameModule<MinesConfig, MinesBet, MinesState, MinesAction, MinesView> = {
  id: 'mines',
  name: 'Mines',
  interactive: true,
  configSchema: minesConfigSchema,
  defaultConfig: { houseEdgeBp: 100, minMines: 1, maxMines: 24, maxMultiplierE4: 10_000_000 },
  betSchema: minesBetSchema,
  actionSchema: minesActionSchema,

  assess(config, bet) {
    validate(config, bet);
    return riskFor(config, { amount: bet.amount, mineCount: bet.mines, revealed: [] });
  },

  wagers(_config, bet) {
    return [{ kind: 'MAIN', amount: bet.amount, selection: { mines: bet.mines } }];
  },

  start(config, bet, rng: RandomSource) {
    validate(config, bet);
    const order = shuffle(Array.from({ length: MINES_TILES }, (_, i) => i), rng);
    const state: MinesState = {
      amount: bet.amount,
      mineCount: bet.mines,
      mines: order.slice(0, bet.mines).sort((a, b) => a - b),
      revealed: [],
      multiplierE4: 10_000,
      status: 'playing',
      hitMine: null,
      payout: 0,
    };
    return { state, status: 'OPEN', payout: 0, additionalStakes: [], risk: riskFor(config, state) };
  },

  act(config, state, action) {
    if (state.status !== 'playing') throw new GameRuleError('ROUND_FINISHED', 'This round has finished');
    if (action.type === 'cashout') {
      if (state.revealed.length === 0) throw new GameRuleError('NOTHING_TO_CASH_OUT', 'Reveal at least one tile before cashing out');
      const payout = mulDivFloor(state.amount, state.multiplierE4, 10_000);
      return finish(config, { ...state, status: 'cashed', payout });
    }
    if (state.revealed.includes(action.tile)) throw new GameRuleError('TILE_REVEALED', 'That tile is already revealed');
    if (state.mines.includes(action.tile)) {
      return finish(config, { ...state, status: 'busted', hitMine: action.tile, payout: 0 });
    }
    const revealed = [...state.revealed, action.tile];
    const mult = multiplierE4(config, state.mineCount, revealed.length);
    const next: MinesState = { ...state, revealed, multiplierE4: mult };
    if (revealed.length >= maxPicks(config, state.mineCount)) {
      // All safe tiles found, or the multiplier cap reached: settle automatically.
      return finish(config, { ...next, status: 'cashed', payout: mulDivFloor(state.amount, mult, 10_000) });
    }
    return { state: next, status: 'OPEN', payout: 0, additionalStakes: [], risk: riskFor(config, next) };
  },

  expire() {
    return null; // Mines rounds never expire; the player can always return and continue.
  },

  expiresAfterMs() {
    return null; // Mines rounds never expire; the player can always return and continue.
  },

  view(config, state, isFinal) {
    const playing = !isFinal && state.status === 'playing';
    const k = state.revealed.length;
    const top = maxPicks(config, state.mineCount);
    return {
      amount: state.amount,
      mineCount: state.mineCount,
      mines: playing ? null : state.mines,
      revealed: state.revealed,
      multiplierE4: state.multiplierE4,
      status: state.status,
      hitMine: state.hitMine,
      payout: state.payout,
      nextMultiplierE4: playing && k < top ? multiplierE4(config, state.mineCount, k + 1) : null,
      nextSafeProbability: playing && k < top ? (MINES_TILES - state.mineCount - k) / (MINES_TILES - k) : null,
      maxPicks: top,
    };
  },

  theoretical(config) {
    const edge = config.houseEdgeBp / 10_000;
    return {
      rtp: 1 - edge,
      houseEdge: edge,
      method: 'exact',
      notes: `Cashing out after any number of safe picks returns at most ${((1 - edge) * 100).toFixed(2)}% on average; the 4-decimal multiplier floor lowers it by under 0.01 percentage points.`,
    };
  },
};
