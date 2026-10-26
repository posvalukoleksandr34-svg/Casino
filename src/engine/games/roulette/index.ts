import { z } from 'zod';
import { sumMinor } from '../../money';
import type { RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { GameRuleError, notInteractive, settled, type GameModule, type RiskProfile, type StepResult } from '../types';
import { grossReturn, pocketColor, positionKey, POCKETS, type PocketColor, type RouletteBet } from './rules';

export * from './rules';

export const rouletteConfigSchema = z.object({
  /** Maximum number of distinct betting positions per spin. */
  maxPositions: z.int().min(1).max(160),
});
export type RouletteConfig = z.infer<typeof rouletteConfigSchema>;

const evenMoney = z.enum(['red', 'black', 'odd', 'even', 'low', 'high']);

export const rouletteBetItemSchema = z.union([
  z.object({ type: z.literal('straight'), number: z.int().min(0).max(36), amount: stakeSchema }).strict(),
  z.object({ type: evenMoney, amount: stakeSchema }).strict(),
  z
    .object({
      type: z.enum(['dozen', 'column']),
      index: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      amount: stakeSchema,
    })
    .strict(),
]);

export const rouletteBetSchema = z
  .object({
    bets: z.array(rouletteBetItemSchema).min(1).max(160),
  })
  .strict();
export type RouletteBetInput = z.infer<typeof rouletteBetSchema>;

export interface RouletteBetResult {
  bet: RouletteBet;
  won: boolean;
  payout: number;
}

export interface RouletteState {
  bets: RouletteBet[];
  result: number;
  color: PocketColor;
  results: RouletteBetResult[];
  payout: number;
}

/** Merges chips placed on the same position so each position appears once. */
export function normalizeBets(bets: readonly RouletteBet[]): RouletteBet[] {
  const merged = new Map<string, RouletteBet>();
  for (const bet of bets) {
    const key = positionKey(bet);
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, amount: sumMinor([existing.amount, bet.amount]) } : { ...bet });
  }
  return [...merged.values()];
}

/** Gross payout for every pocket, index = pocket number. */
export function payoutTable(bets: readonly RouletteBet[]): number[] {
  const table: number[] = [];
  for (let n = 0; n < POCKETS; n += 1) {
    table.push(sumMinor(bets.map((b) => grossReturn(b, n))));
  }
  return table;
}

export function rouletteRisk(bets: readonly RouletteBet[]): RiskProfile {
  const table = payoutTable(bets);
  const stake = sumMinor(bets.map((b) => b.amount));
  let mean = 0;
  let second = 0;
  for (const p of table) {
    mean += p / POCKETS;
    second += (p * p) / POCKETS;
  }
  return {
    stake,
    maxPayout: Math.max(...table),
    expectedPayout: mean,
    payoutVariance: Math.max(0, second - mean * mean),
  };
}

function validated(config: RouletteConfig, input: RouletteBetInput): RouletteBet[] {
  const bets = normalizeBets(input.bets as RouletteBet[]);
  if (bets.length > config.maxPositions) {
    throw new GameRuleError('TOO_MANY_POSITIONS', `At most ${config.maxPositions} betting positions per spin`, {
      maxPositions: config.maxPositions,
    });
  }
  return bets;
}

export const roulette: GameModule<RouletteConfig, RouletteBetInput, RouletteState, never, RouletteState> = {
  id: 'roulette',
  name: 'European Roulette',
  interactive: false,
  configSchema: rouletteConfigSchema,
  defaultConfig: { maxPositions: 64 },
  betSchema: rouletteBetSchema,
  actionSchema: null,

  assess(config, input) {
    return rouletteRisk(validated(config, input));
  },

  wagers(config, input) {
    return validated(config, input).map((bet) => {
      const { amount, ...selection } = bet;
      return { kind: bet.type, amount, selection };
    });
  },

  start(config, input, rng: RandomSource): StepResult<RouletteState> {
    const bets = validated(config, input);
    const result = rng.nextInt(POCKETS);
    const results = bets.map((bet) => {
      const payout = grossReturn(bet, result);
      return { bet, won: payout > 0, payout };
    });
    const payout = sumMinor(results.map((r) => r.payout));
    return settled(
      { bets, result, color: pocketColor(result), results, payout },
      payout,
      rouletteRisk(bets),
    );
  },

  act() {
    return notInteractive('roulette');
  },

  expire() {
    return null;
  },

  view(_config, state) {
    return state;
  },

  theoretical() {
    return {
      rtp: 36 / 37,
      houseEdge: 1 / 37,
      method: 'exact',
      notes:
        'Every bet type returns 36/37 of the stake on average: e.g. a straight-up bet wins 36× with probability 1/37; red wins 2× with probability 18/37.',
    };
  },
};
