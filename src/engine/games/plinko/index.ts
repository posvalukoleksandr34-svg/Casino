/**
 * Plinko (instant, server-authoritative).
 *
 * The player picks a number of rows R ∈ {8, 12, 16} and a risk level. The
 * server decides the ball's whole path before anything is shown: one fair
 * left/right bit per row from the provably fair stream (rng.nextInt(2)). The
 * landing slot is the number of right bounces, k ~ Binomial(R, 1/2):
 *   P(k) = C(R, k) / 2^R,      k = 0 … R
 * and the round pays ⌊stake · m(R, risk, k)⌋, with the symmetric multiplier
 * table in the immutable game configuration (hundredths of a multiple).
 * The animation replays the stored path; it never decides anything.
 *
 * RTP(R, risk) = Σₖ C(R, k) · m(k) / (100 · 2^R). The configuration schema
 * refuses tables that are not symmetric or whose exact RTP is not strictly
 * below 100%; every default table returns at most 99.00% (docs/math/plinko.md).
 */
import { z } from 'zod';
import { binomial } from '../../combinatorics';
import { MAX_MULTIPLIER, mulDivFloor } from '../../money';
import type { RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { discreteMoments, notInteractive, settled, type GameModule, type RiskProfile } from '../types';

export const PLINKO_ROWS = [8, 12, 16] as const;
export const PLINKO_RISKS = ['low', 'medium', 'high'] as const;
export type PlinkoRows = (typeof PLINKO_ROWS)[number];
export type PlinkoRisk = (typeof PLINKO_RISKS)[number];

/** Default multiplier tables, hundredths of a multiple, keyed "rows:risk", slot 0 … R. */
export const PLINKO_DEFAULT_TABLES: Record<string, number[]> = {
  '8:low': [426, 241, 140, 83, 50, 83, 140, 241, 426],
  '8:medium': [752, 321, 144, 70, 40, 70, 144, 321, 752],
  '8:high': [1760, 482, 137, 45, 20, 45, 137, 482, 1760],
  '12:low': [606, 406, 267, 177, 116, 76, 50, 76, 116, 177, 267, 406, 606],
  '12:medium': [1497, 758, 388, 201, 109, 63, 40, 63, 109, 201, 388, 758, 1497],
  '12:high': [6395, 2075, 677, 226, 81, 35, 20, 35, 81, 226, 677, 2075, 6395],
  '16:low': [790, 573, 409, 293, 209, 149, 104, 73, 50, 73, 104, 149, 209, 293, 409, 573, 790],
  '16:medium': [2684, 1493, 839, 472, 269, 157, 93, 59, 40, 59, 93, 157, 269, 472, 839, 1493, 2684],
  '16:high': [18764, 6956, 2587, 966, 366, 143, 61, 31, 20, 31, 61, 143, 366, 966, 2587, 6956, 18764],
};

export const plinkoKey = (rows: number, risk: string) => `${rows}:${risk}`;

/** Exact RTP of a table as a fraction (numerator, denominator). */
export function plinkoRtpFraction(rows: number, table: readonly number[]): { num: bigint; den: bigint } {
  const num = table.reduce((s, m, k) => s + binomial(rows, k) * BigInt(m), 0n);
  return { num, den: 2n ** BigInt(rows) * 100n };
}

export function plinkoRtp(rows: number, table: readonly number[]): number {
  const { num, den } = plinkoRtpFraction(rows, table);
  return Number(num) / Number(den);
}

export function plinkoSlotProbability(rows: number, slot: number): number {
  return Number(binomial(rows, slot)) / 2 ** rows;
}

export const plinkoConfigSchema = z
  .object({ tables: z.record(z.string(), z.array(z.int().min(0).max(MAX_MULTIPLIER * 100))) })
  .superRefine((c, ctx) => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const key = plinkoKey(rows, risk);
        const t = c.tables[key];
        if (!t || t.length !== rows + 1) {
          ctx.addIssue({ code: 'custom', message: `table ${key} needs ${rows + 1} slots` });
          continue;
        }
        if (t.some((m, k) => m !== t[rows - k])) ctx.addIssue({ code: 'custom', message: `table ${key} must be symmetric` });
        const { num, den } = plinkoRtpFraction(rows, t);
        if (num >= den) ctx.addIssue({ code: 'custom', message: `table ${key}: RTP must be strictly below 100%` });
      }
    }
    if (Object.keys(c.tables).length !== PLINKO_ROWS.length * PLINKO_RISKS.length) {
      ctx.addIssue({ code: 'custom', message: 'tables must cover exactly every rows × risk combination' });
    }
  });
export type PlinkoConfig = z.infer<typeof plinkoConfigSchema>;

export const plinkoBetSchema = z
  .object({
    amount: stakeSchema,
    rows: z.union([z.literal(8), z.literal(12), z.literal(16)]),
    risk: z.enum(PLINKO_RISKS),
  })
  .strict();
export type PlinkoBet = z.infer<typeof plinkoBetSchema>;

export interface PlinkoState {
  amount: number;
  rows: PlinkoRows;
  risk: PlinkoRisk;
  /** One entry per row: 0 = bounced left, 1 = bounced right. */
  path: number[];
  slot: number;
  multiplierE2: number;
  payout: number;
}

function quote(config: PlinkoConfig, bet: PlinkoBet) {
  const table = config.tables[plinkoKey(bet.rows, bet.risk)]!;
  const payouts = table.map((m) => mulDivFloor(bet.amount, m, 100));
  const { mean, variance } = discreteMoments(payouts.map((payout, k) => ({ p: plinkoSlotProbability(bet.rows, k), payout })));
  const risk: RiskProfile = { stake: bet.amount, maxPayout: Math.max(...payouts), expectedPayout: mean, payoutVariance: variance };
  return { table, risk };
}

/** The ball's path for a stream: R fair bits, consumed one per row. */
export function dropPath(rows: number, rng: RandomSource): number[] {
  return Array.from({ length: rows }, () => rng.nextInt(2));
}

export const plinko: GameModule<PlinkoConfig, PlinkoBet, PlinkoState, never, PlinkoState> = {
  id: 'plinko',
  name: 'Plinko',
  interactive: false,
  configSchema: plinkoConfigSchema,
  defaultConfig: { tables: PLINKO_DEFAULT_TABLES },
  betSchema: plinkoBetSchema,
  actionSchema: null,

  assess(config, bet) {
    return quote(config, bet).risk;
  },

  wagers(_config, bet) {
    return [{ kind: 'MAIN', amount: bet.amount, selection: { rows: bet.rows, risk: bet.risk } }];
  },

  start(config, bet, rng: RandomSource) {
    const q = quote(config, bet);
    const path = dropPath(bet.rows, rng);
    const slot = path.reduce((a, b) => a + b, 0);
    const multiplierE2 = q.table[slot]!;
    const payout = mulDivFloor(bet.amount, multiplierE2, 100);
    return settled({ amount: bet.amount, rows: bet.rows, risk: bet.risk, path, slot, multiplierE2, payout }, payout, q.risk);
  },

  act() {
    return notInteractive('plinko');
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
    const rtps = PLINKO_ROWS.flatMap((r) => PLINKO_RISKS.map((k) => plinkoRtp(r, config.tables[plinkoKey(r, k)]!)));
    const lo = Math.min(...rtps);
    const hi = Math.max(...rtps);
    return {
      rtp: lo,
      houseEdge: 1 - lo,
      method: 'exact',
      notes: `Exact RTP for each rows × risk table: between ${(lo * 100).toFixed(3)}% and ${(hi * 100).toFixed(3)}%. Risk changes the spread of results, not the long-run return.`,
    };
  },
};
