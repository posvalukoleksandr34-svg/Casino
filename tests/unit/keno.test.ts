import { describe, expect, it } from 'vitest';
import { binomial } from '@/engine/combinatorics';
import {
  drawKeno,
  keno,
  KENO_DEFAULT_TABLE,
  kenoBetSchema,
  kenoConfigSchema,
  kenoHitProbability,
  kenoHitWeights,
  kenoRowRtpFraction,
} from '@/engine/games/keno';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { verifyOutcome } from '@/engine/verify';
import { kenoRtp } from '../../scripts/sim/independent-rtp';

const config = keno.defaultConfig;
const input = (nonce: number) => ({ serverSeed: 'b2'.repeat(32), clientSeed: 'keno', nonce });
const rng = (nonce: number) => new HmacRandomStream(input(nonce));

describe('keno maths (exact)', () => {
  it('hit weights form the hypergeometric distribution', () => {
    for (let n = 1; n <= 10; n += 1) {
      expect(kenoHitWeights(n).reduce((a, b) => a + b, 0n)).toBe(binomial(40, 10));
    }
    expect(kenoHitProbability(1, 1)).toBeCloseTo(10 / 40, 15);
    expect(kenoHitProbability(10, 10)).toBeCloseTo(1 / 847_660_528, 20);
  });

  it('every default row returns at most 99% exactly, at least 98.9%, and pays more for more hits', () => {
    for (let n = 1; n <= 10; n += 1) {
      const row = KENO_DEFAULT_TABLE[String(n)]!;
      const { num, den } = kenoRowRtpFraction(n, row);
      expect(num * 100n <= den * 99n).toBe(true);
      expect(num * 1000n >= den * 989n).toBe(true);
      for (let k = 1; k <= n; k += 1) expect(row[k]!).toBeGreaterThanOrEqual(row[k - 1]!);
      expect(Number(num) / Number(den)).toBeCloseTo(kenoRtp(n, row), 14); // independent derivation
    }
    const t = keno.theoretical(config);
    expect(t.method).toBe('exact');
    expect(t.rtp).toBeLessThanOrEqual(0.99);
  });

  it('the configuration schema refuses unsafe or malformed tables', () => {
    expect(kenoConfigSchema.safeParse(config).success).toBe(true);
    const rich = { ...KENO_DEFAULT_TABLE, '1': [0, 400] }; // 1 pick: 25% × 4.00× = 100%
    expect(kenoConfigSchema.safeParse({ table: rich }).success).toBe(false);
    const dropping = { ...KENO_DEFAULT_TABLE, '2': [0, 300, 200] };
    expect(kenoConfigSchema.safeParse({ table: dropping }).success).toBe(false);
    const { '10': _omit, ...missing } = KENO_DEFAULT_TABLE;
    expect(kenoConfigSchema.safeParse({ table: missing }).success).toBe(false);
    expect(kenoConfigSchema.safeParse({ table: { ...KENO_DEFAULT_TABLE, '11': [0] } }).success).toBe(false);
    expect(kenoConfigSchema.safeParse({ table: { ...KENO_DEFAULT_TABLE, '3': [0, 0, 501] } }).success).toBe(false);
  });
});

describe('keno rounds', () => {
  it('draws 10 distinct numbers from 1–40, independent of the picks', () => {
    for (let nonce = 0; nonce < 500; nonce += 1) {
      const drawn = drawKeno(rng(nonce));
      expect(drawn).toHaveLength(10);
      expect(new Set(drawn).size).toBe(10);
      expect(drawn.every((x) => Number.isInteger(x) && x >= 1 && x <= 40)).toBe(true);
      expect([...drawn].sort((a, b) => a - b)).toEqual(drawn);
      const a = keno.start(config, { amount: 100, picks: [1, 2, 3] }, rng(nonce)).state.drawn;
      const b = keno.start(config, { amount: 5_000, picks: [40, 39, 38, 37, 36, 35, 34, 33, 32, 31] }, rng(nonce)).state.drawn;
      expect(a).toEqual(drawn);
      expect(b).toEqual(drawn);
    }
  });

  it('pays ⌊stake × m(n, hits)⌋ and never above the declared maximum', () => {
    for (let nonce = 0; nonce < 2_000; nonce += 1) {
      const n = 1 + (nonce % 10);
      const picks = Array.from({ length: n }, (_, i) => ((nonce * 7 + i * 3) % 40) + 1);
      if (new Set(picks).size !== n) continue;
      const amount = 1 + ((nonce * 97) % 10_000);
      const step = keno.start(config, { amount, picks }, rng(nonce));
      const hits = picks.filter((p) => step.state.drawn.includes(p)).length;
      expect(step.state.hits).toHaveLength(hits);
      expect(step.state.multiplierE2).toBe(KENO_DEFAULT_TABLE[String(n)]![hits]);
      expect(step.payout).toBe(Math.floor((amount * step.state.multiplierE2) / 100));
      expect(step.payout).toBeLessThanOrEqual(step.risk.maxPayout);
      expect(step.state.picks).toEqual([...picks].sort((a, b) => a - b));
    }
  });

  it('rejects malformed picks', () => {
    for (const picks of [[], [0], [41], [1, 1], [1.5], Array.from({ length: 11 }, (_, i) => i + 1)]) {
      expect(kenoBetSchema.safeParse({ amount: 100, picks }).success).toBe(false);
    }
    expect(kenoBetSchema.safeParse({ amount: 100, picks: [5], other: true }).success).toBe(false);
    expect(kenoBetSchema.safeParse({ amount: 100, picks: [1, 40] }).success).toBe(true);
  });

  it('the verifier recomputes the same draw', () => {
    for (let nonce = 0; nonce < 100; nonce += 1) {
      expect(verifyOutcome('keno', input(nonce)).outcome.drawn).toEqual(keno.start(config, { amount: 1, picks: [7] }, rng(nonce)).state.drawn);
    }
  });
});
