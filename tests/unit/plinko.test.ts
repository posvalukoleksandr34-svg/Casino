import { describe, expect, it } from 'vitest';
import {
  dropPath,
  plinko,
  plinkoBetSchema,
  plinkoConfigSchema,
  PLINKO_DEFAULT_TABLES,
  PLINKO_RISKS,
  PLINKO_ROWS,
  plinkoKey,
  plinkoRtpFraction,
  plinkoSlotProbability,
  type PlinkoRisk,
  type PlinkoRows,
} from '@/engine/games/plinko';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { verifyOutcome } from '@/engine/verify';
import { plinkoRtp } from '../../scripts/sim/independent-rtp';

const config = plinko.defaultConfig;
const input = (nonce: number) => ({ serverSeed: 'c3'.repeat(32), clientSeed: 'plinko', nonce });
const rng = (nonce: number) => new HmacRandomStream(input(nonce));

describe('plinko maths (exact)', () => {
  it('every default table is symmetric and returns at most 99% exactly (at least 98.9%)', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const t = PLINKO_DEFAULT_TABLES[plinkoKey(rows, risk)]!;
        expect(t).toHaveLength(rows + 1);
        expect(t).toEqual([...t].reverse());
        const { num, den } = plinkoRtpFraction(rows, t);
        expect(num * 100n <= den * 99n).toBe(true);
        expect(num * 1000n >= den * 989n).toBe(true);
        expect(Number(num) / Number(den)).toBeCloseTo(plinkoRtp(rows, t), 14); // independent derivation
        // Outer slots pay the most; the centre the least.
        expect(Math.max(...t)).toBe(t[0]);
        expect(Math.min(...t)).toBe(t[rows / 2]);
      }
    }
    expect(plinko.theoretical(config).rtp).toBeLessThanOrEqual(0.99);
  });

  it('slot probabilities are binomial and sum to one', () => {
    for (const rows of PLINKO_ROWS) {
      const total = Array.from({ length: rows + 1 }, (_, k) => plinkoSlotProbability(rows, k)).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 14);
    }
    expect(plinkoSlotProbability(16, 0)).toBe(1 / 65_536);
  });

  it('the configuration schema refuses unsafe or malformed tables', () => {
    expect(plinkoConfigSchema.safeParse(config).success).toBe(true);
    const asym = [...PLINKO_DEFAULT_TABLES['8:low']!];
    asym[0] = 500;
    expect(plinkoConfigSchema.safeParse({ tables: { ...PLINKO_DEFAULT_TABLES, '8:low': asym } }).success).toBe(false);
    const rich = PLINKO_DEFAULT_TABLES['8:low']!.map((m) => m + 10);
    expect(plinkoConfigSchema.safeParse({ tables: { ...PLINKO_DEFAULT_TABLES, '8:low': rich } }).success).toBe(false);
    const { '16:high': _omit, ...missing } = PLINKO_DEFAULT_TABLES;
    expect(plinkoConfigSchema.safeParse({ tables: missing }).success).toBe(false);
    expect(plinkoConfigSchema.safeParse({ tables: { ...PLINKO_DEFAULT_TABLES, '10:low': [100] } }).success).toBe(false);
  });
});

describe('plinko rounds', () => {
  it('the path has one fair bit per row; the slot is the number of right bounces', () => {
    for (let nonce = 0; nonce < 1_500; nonce += 1) {
      const rows = PLINKO_ROWS[nonce % 3]! as PlinkoRows;
      const risk = PLINKO_RISKS[(nonce >> 2) % 3]! as PlinkoRisk;
      const amount = 1 + ((nonce * 131) % 100_000);
      const step = plinko.start(config, { amount, rows, risk }, rng(nonce));
      expect(step.state.path).toEqual(dropPath(rows, rng(nonce)));
      expect(step.state.path).toHaveLength(rows);
      expect(step.state.path.every((b) => b === 0 || b === 1)).toBe(true);
      expect(step.state.slot).toBe(step.state.path.reduce((a, b) => a + b, 0));
      expect(step.state.multiplierE2).toBe(PLINKO_DEFAULT_TABLES[plinkoKey(rows, risk)]![step.state.slot]);
      expect(step.payout).toBe(Math.floor((amount * step.state.multiplierE2) / 100));
      expect(step.payout).toBeLessThanOrEqual(step.risk.maxPayout);
    }
  });

  it('risk only selects the table: the same seed lands in the same slot at every risk level', () => {
    const slots = PLINKO_RISKS.map((risk) => plinko.start(config, { amount: 100, rows: 12, risk }, rng(42)).state.slot);
    expect(new Set(slots).size).toBe(1);
  });

  it('rejects malformed bets', () => {
    for (const bad of [
      { amount: 100, rows: 10, risk: 'low' },
      { amount: 100, rows: 8, risk: 'extreme' },
      { amount: 100, rows: '8', risk: 'low' },
      { amount: 100, rows: 8, risk: 'low', path: [1] },
    ]) {
      expect(plinkoBetSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('the verifier recomputes the same path and slot', () => {
    for (let nonce = 0; nonce < 100; nonce += 1) {
      const step = plinko.start(config, { amount: 1, rows: 16, risk: 'high' }, rng(nonce));
      const v = verifyOutcome('plinko', input(nonce), { rows: 16 }).outcome;
      expect(v.slot).toBe(step.state.slot);
      expect(v.path).toBe(step.state.path.map((b) => (b ? 'R' : 'L')).join(''));
    }
    expect(() => verifyOutcome('plinko', input(0), { rows: 10 })).toThrow(/Rows/);
  });
});
