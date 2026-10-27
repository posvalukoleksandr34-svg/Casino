/**
 * Keno (instant, server-authoritative).
 *
 * The board holds the numbers 1–40. The player picks n distinct numbers
 * (1 ≤ n ≤ 10); the server draws 10 distinct numbers with a provably fair
 * Fisher–Yates shuffle of 1–40 (the first 10). With k matches ("hits"):
 *   P(k | n) = C(n, k) · C(40 − n, 10 − k) / C(40, 10)      (hypergeometric)
 * and the round pays ⌊stake · m(n, k)⌋, with the multiplier table m stored
 * in the immutable game configuration (hundredths of a multiple).
 *
 * RTP(n) = Σₖ P(k | n) · m(n, k). The configuration schema refuses any table
 * whose exact RTP for some n is not strictly below 100%; the default table
 * returns 98.98–99.00% for every n (docs/math/keno.md).
 */
import { z } from 'zod';
import { binomial } from '../../combinatorics';
import { MAX_MULTIPLIER, mulDivFloor } from '../../money';
import { shuffle, type RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { discreteMoments, GameRuleError, notInteractive, settled, type GameModule, type RiskProfile } from '../types';

export const KENO_NUMBERS = 40;
export const KENO_DRAWN = 10;
export const KENO_MAX_PICKS = 10;

/** Default payout table, hundredths of a multiple, indexed [picks][hits]. */
export const KENO_DEFAULT_TABLE: Record<string, number[]> = {
  '1': [0, 396],
  '2': [0, 160, 649],
  '3': [0, 0, 501, 2514],
  '4': [0, 0, 211, 1057, 5295],
  '5': [0, 0, 0, 723, 3625, 18113],
  '6': [0, 0, 0, 355, 1597, 7190, 32387],
  '7': [0, 0, 0, 0, 1318, 5281, 21103, 84446],
  '8': [0, 0, 0, 0, 705, 2538, 9149, 32912, 118459],
  '9': [0, 0, 0, 0, 0, 2618, 8645, 28534, 94130, 310674],
  '10': [0, 0, 0, 0, 0, 1444, 4332, 12997, 39014, 117013, 350994],
};

/** Numerators of P(k | n) over the common denominator C(40, 10). */
export function kenoHitWeights(picks: number): bigint[] {
  return Array.from({ length: picks + 1 }, (_, k) => binomial(picks, k) * binomial(KENO_NUMBERS - picks, KENO_DRAWN - k));
}

export function kenoHitProbability(picks: number, hits: number): number {
  return Number(kenoHitWeights(picks)[hits] ?? 0n) / Number(binomial(KENO_NUMBERS, KENO_DRAWN));
}

/** Exact RTP of a row as a fraction (numerator, denominator). */
export function kenoRowRtpFraction(picks: number, row: readonly number[]): { num: bigint; den: bigint } {
  const w = kenoHitWeights(picks);
  const num = w.reduce((s, x, k) => s + x * BigInt(row[k] ?? 0), 0n);
  return { num, den: binomial(KENO_NUMBERS, KENO_DRAWN) * 100n };
}

export function kenoRowRtp(picks: number, row: readonly number[]): number {
  const { num, den } = kenoRowRtpFraction(picks, row);
  return Number(num) / Number(den);
}

const rowSchema = z.array(z.int().min(0).max(MAX_MULTIPLIER * 100));

export const kenoConfigSchema = z
  .object({ table: z.record(z.string(), rowSchema) })
  .superRefine((c, ctx) => {
    for (let n = 1; n <= KENO_MAX_PICKS; n += 1) {
      const row = c.table[String(n)];
      if (!row || row.length !== n + 1) {
        ctx.addIssue({ code: 'custom', message: `table row for ${n} picks needs ${n + 1} entries (0–${n} hits)` });
        continue;
      }
      for (let k = 1; k <= n; k += 1) {
        if (row[k]! < row[k - 1]!) ctx.addIssue({ code: 'custom', message: `${n} picks: more hits must never pay less` });
      }
      const { num, den } = kenoRowRtpFraction(n, row);
      if (num >= den) ctx.addIssue({ code: 'custom', message: `${n} picks: RTP must be strictly below 100%` });
    }
    if (Object.keys(c.table).length !== KENO_MAX_PICKS) ctx.addIssue({ code: 'custom', message: 'table must have exactly rows 1–10' });
  });
export type KenoConfig = z.infer<typeof kenoConfigSchema>;

export const kenoBetSchema = z
  .object({
    amount: stakeSchema,
    picks: z
      .array(z.int().min(1).max(KENO_NUMBERS))
      .min(1)
      .max(KENO_MAX_PICKS)
      .refine((p) => new Set(p).size === p.length, { message: 'Picked numbers must be distinct' }),
  })
  .strict();
export type KenoBet = z.infer<typeof kenoBetSchema>;

export interface KenoState {
  amount: number;
  picks: number[];
  drawn: number[];
  hits: number[];
  multiplierE2: number;
  payout: number;
}

function quote(config: KenoConfig, bet: KenoBet) {
  const n = bet.picks.length;
  const row = config.table[String(n)];
  if (!row) throw new GameRuleError('PICKS_OUT_OF_RANGE', `Pick between 1 and ${KENO_MAX_PICKS} numbers`);
  const payouts = row.map((m) => mulDivFloor(bet.amount, m, 100));
  const total = Number(binomial(KENO_NUMBERS, KENO_DRAWN));
  const { mean, variance } = discreteMoments(kenoHitWeights(n).map((w, k) => ({ p: Number(w) / total, payout: payouts[k]! })));
  const risk: RiskProfile = { stake: bet.amount, maxPayout: Math.max(...payouts), expectedPayout: mean, payoutVariance: variance };
  return { row, risk };
}

/** The 10 drawn numbers for a stream: the first 10 of a shuffle of 1–40, ascending. */
export function drawKeno(rng: RandomSource): number[] {
  const order = shuffle(Array.from({ length: KENO_NUMBERS }, (_, i) => i + 1), rng);
  return order.slice(0, KENO_DRAWN).sort((a, b) => a - b);
}

export const keno: GameModule<KenoConfig, KenoBet, KenoState, never, KenoState> = {
  id: 'keno',
  name: 'Keno',
  interactive: false,
  configSchema: kenoConfigSchema,
  defaultConfig: { table: KENO_DEFAULT_TABLE },
  betSchema: kenoBetSchema,
  actionSchema: null,

  assess(config, bet) {
    return quote(config, bet).risk;
  },

  wagers(_config, bet) {
    return [{ kind: 'MAIN', amount: bet.amount, selection: { picks: [...bet.picks].sort((a, b) => a - b) } }];
  },

  start(config, bet, rng: RandomSource) {
    const q = quote(config, bet);
    const drawn = drawKeno(rng);
    const picks = [...bet.picks].sort((a, b) => a - b);
    const hits = picks.filter((p) => drawn.includes(p));
    const multiplierE2 = q.row[hits.length]!;
    const payout = mulDivFloor(bet.amount, multiplierE2, 100);
    return settled({ amount: bet.amount, picks, drawn, hits, multiplierE2, payout }, payout, q.risk);
  },

  act() {
    return notInteractive('keno');
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
    const rtps = Array.from({ length: KENO_MAX_PICKS }, (_, i) => kenoRowRtp(i + 1, config.table[String(i + 1)]!));
    const lo = Math.min(...rtps);
    const hi = Math.max(...rtps);
    return {
      rtp: lo,
      houseEdge: 1 - lo,
      method: 'exact',
      notes: `Exact RTP depends on how many numbers you pick: between ${(lo * 100).toFixed(3)}% and ${(hi * 100).toFixed(3)}%. The figure shown is the lowest.`,
    };
  },
};
