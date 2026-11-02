import { describe, expect, it } from 'vitest';
import { analyseMachine, awardFor, evaluateGrid, playSlotRound, slotBetSchema, slotConfigSchema, windowAt, SLOT_REELS, type SlotConfig } from '@/engine/games/slots/engine';
import { EMBER_FRUITS, LANTERN_HOLLOW, SANDS_OF_AURUM } from '@/engine/games/slots/machines';
import { emberFruits, lanternHollow, sandsOfAurum } from '@/engine/games/slots';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { MAX_MULTIPLIER } from '@/engine/money';

const rng = (nonce: number, seed = 'c3') => new HmacRandomStream({ serverSeed: seed.repeat(32), clientSeed: 'slots', nonce });

/** A tiny machine whose every stop combination can be enumerated (8–9 stops per reel); RTP about 83%. */
const TINY: SlotConfig = {
  symbols: [
    { id: 'w', name: 'Wild', kind: 'wild', pays: [0, 0, 0] },
    { id: 's', name: 'Scatter', kind: 'scatter', pays: [0, 0, 0] },
    { id: 'h', name: 'High', kind: 'high', pays: [1, 2, 8] },
    { id: 'm', name: 'Mid', kind: 'high', pays: [0, 1, 4] },
    { id: 'a', name: 'A', kind: 'low', pays: [0, 0, 1] },
    { id: 'b', name: 'B', kind: 'low', pays: [0, 0, 1] },
  ],
  reels: [
    ['a', 'b', 'h', 'a', 's', 'm', 'b', 'a'],
    ['b', 'w', 'a', 'm', 'b', 's', 'h', 'a', 'b'],
    ['a', 'm', 'b', 'w', 'a', 'h', 's', 'b'],
    ['h', 'b', 'a', 's', 'm', 'w', 'b', 'a', 'b'],
    ['b', 'a', 'm', 'b', 'w', 'h', 'a', 's'],
  ],
  freeSpins: { awards: [3, 5, 8], multiplier: 2 },
};

/** Exhaustive enumeration with the same evaluator the game uses at run time. */
function bruteForce(config: SlotConfig) {
  const lens = config.reels.map((r) => r.length);
  const total = lens.reduce((a, b) => a * b, 1);
  let sumB = 0;
  let sumB2 = 0;
  let hits = 0;
  const byZ = new Map<number, { count: number; sumB: number; maxB: number }>();
  let maxSpin = 0;
  const stops = new Array<number>(SLOT_REELS).fill(0);
  for (let idx = 0; idx < total; idx += 1) {
    let rest = idx;
    for (let i = 0; i < SLOT_REELS; i += 1) {
      stops[i] = rest % lens[i]!;
      rest = Math.floor(rest / lens[i]!);
    }
    const grid = stops.map((s, i) => windowAt(config.reels[i]!, s));
    const e = evaluateGrid(config, grid);
    sumB += e.winE2;
    sumB2 += e.winE2 * e.winE2;
    if (e.winE2 > 0) hits += 1;
    maxSpin = Math.max(maxSpin, e.winE2);
    const z = byZ.get(e.scatters) ?? { count: 0, sumB: 0, maxB: 0 };
    z.count += 1;
    z.sumB += e.winE2;
    z.maxB = Math.max(z.maxB, e.winE2);
    byZ.set(e.scatters, z);
  }
  const m = config.freeSpins.multiplier;
  const mu = sumB / total;
  const varB = sumB2 / total - mu * mu;
  let mean = mu;
  let second = sumB2 / total;
  let pTrig = 0;
  let maxTotal = 0;
  let awardWeight = 0;
  for (const [z, v] of byZ) {
    const n = awardFor(config, z);
    maxTotal = Math.max(maxTotal, v.maxB + n * m * maxSpin);
    if (n === 0) continue;
    const p = v.count / total;
    pTrig += p;
    mean += p * n * m * mu;
    second += 2 * (v.sumB / total) * n * m * mu + p * m * m * (n * varB + n * n * mu * mu);
    awardWeight += v.count * n;
  }
  return { total, sumB, mean, variance: second - mean * mean, pTrig, maxSpin, maxTotal, awardWeight, hitFrequency: hits / total };
}

describe('slot maths: the exact analysis equals exhaustive enumeration', () => {
  it('matches mean, variance, trigger probability, maximum and hit frequency on a small machine', () => {
    const config = slotConfigSchema.parse(TINY);
    const a = analyseMachine(config);
    const b = bruteForce(config);
    expect(a.spinMeanE2 * b.total).toBeCloseTo(b.sumB, 6);
    expect(a.meanE2).toBeCloseTo(b.mean, 9);
    expect(a.varE2).toBeCloseTo(b.variance, 6);
    expect(a.triggerProbability).toBeCloseTo(b.pTrig, 12);
    expect(a.maxSpinE2).toBe(b.maxSpin);
    expect(a.maxTotalE2).toBe(b.maxTotal);
    expect(a.hitFrequency).toBeCloseTo(b.hitFrequency, 12);
    // The exact RTP fraction: ΣB·(T + m·Σ C_k N_k) / (100·T²).
    const T = BigInt(b.total);
    expect(a.rtpNum * (100n * T * T)).toBe(BigInt(b.sumB) * (T + 2n * BigInt(b.awardWeight)) * a.rtpDen);
    expect(a.rtp).toBeCloseTo(b.mean / 100, 8);
  });

  it('matches on randomised small machines too (stacks, several wilds and scatters)', () => {
    const r = rng(7, 'd4');
    const pick = (xs: string[]) => xs[r.nextInt(xs.length)]!;
    for (let trial = 0; trial < 6; trial += 1) {
      const reels = Array.from({ length: SLOT_REELS }, (_, i) =>
        Array.from({ length: 6 + r.nextInt(3) }, () => pick(i === 0 ? ['s', 'h', 'm', 'a', 'b', 'a'] : ['w', 's', 'h', 'm', 'a', 'b', 'a', 'b'])),
      );
      const config = { ...TINY, reels } as SlotConfig;
      const a = analyseMachine(config);
      const b = bruteForce(config);
      expect(a.meanE2).toBeCloseTo(b.mean, 8);
      expect(a.varE2).toBeCloseTo(b.variance, 4);
      expect(a.maxTotalE2).toBe(b.maxTotal);
      expect(a.hitFrequency).toBeCloseTo(b.hitFrequency, 12);
    }
  });
});

describe('slot evaluation', () => {
  const g = (cols: string[]) => cols.map((c) => c.split(''));
  it('pays ways left to right, wilds substitute, scatters count anywhere', () => {
    const config = slotConfigSchema.parse(TINY);
    // h on reels 1–3 (2 × 1 × 2 ways with a wild on reel 3), not on reel 4.
    const e = evaluateGrid(config, g(['hhab', 'ahbb', 'hwba', 'abmb', 'sabb']));
    const h = e.wins.find((w) => w.symbol === 'h')!;
    expect(h.reels).toBe(3);
    expect(h.ways).toBe(2 * 1 * 2);
    expect(h.winE2).toBe(1 * 4);
    expect(h.cells).toEqual([[0, 0], [0, 1], [1, 1], [2, 0], [2, 1]]);
    expect(e.scatters).toBe(1);
    expect(e.winE2).toBe(e.wins.reduce((s, w) => s + w.winE2, 0));
  });

  it('a symbol missing from reel 1 never pays, even with wilds after it', () => {
    const config = slotConfigSchema.parse(TINY);
    const e = evaluateGrid(config, g(['aaaa', 'wwww', 'wwww', 'wwww', 'wwww']));
    expect(e.wins.map((w) => w.symbol)).toEqual(['a']);
    expect(e.wins[0]!.ways).toBe(4 * 4 * 4 * 4 * 4);
  });
});

describe('the three machines', () => {
  const machines = [
    ['Lantern Hollow', LANTERN_HOLLOW, lanternHollow],
    ['Ember Fruits', EMBER_FRUITS, emberFruits],
    ['Sands of Aurum', SANDS_OF_AURUM, sandsOfAurum],
  ] as const;

  it.each(machines)('%s: valid, RTP between 96% and 97% exactly, bounded maximum, free spins 1 in 120–200', (_name, config, mod) => {
    const parsed = slotConfigSchema.parse(config);
    const a = analyseMachine(parsed);
    expect(a.rtpNum < a.rtpDen).toBe(true);
    expect(a.rtpNum * 100n >= a.rtpDen * 96n).toBe(true);
    expect(a.rtpNum * 100n < a.rtpDen * 97n).toBe(true);
    expect(a.maxTotalE2).toBeLessThanOrEqual(6_000 * 100);
    expect(a.maxTotalE2).toBeLessThanOrEqual(MAX_MULTIPLIER * 100);
    expect(1 / a.triggerProbability).toBeGreaterThan(120);
    expect(1 / a.triggerProbability).toBeLessThan(200);
    const t = mod.theoretical(parsed);
    expect(t.method).toBe('exact');
    expect(t.rtp).toBeCloseTo(a.rtp, 9);
  });

  it.each(machines)('%s: a round is deterministic for its seeds and pays stake × total, rounded down', (_name, config, mod) => {
    const amount = 1_234;
    for (let nonce = 0; nonce < 300; nonce += 1) {
      const a = mod.start(config, { amount }, rng(nonce));
      const b = mod.start(config, { amount }, rng(nonce));
      expect(b).toEqual(a);
      const s = a.state;
      expect(a.status).toBe('SETTLED');
      expect(s.freeSpins).toHaveLength(awardFor(config, s.base.scatters));
      for (const f of s.freeSpins) {
        const raw = evaluateGrid(config, f.grid).winE2;
        expect(f.winE2).toBe(raw * config.freeSpins.multiplier);
      }
      expect(s.totalE2).toBe(s.base.winE2 + s.freeSpins.reduce((x, f) => x + f.winE2, 0));
      expect(a.payout).toBe(Math.floor((amount * s.totalE2) / 100));
      expect(a.payout).toBeLessThanOrEqual(a.risk.maxPayout);
      s.base.grid.forEach((col, i) => expect(col).toEqual(windowAt(config.reels[i]!, s.base.stops[i]!)));
    }
  });

  it('free spins are reached and replayed from the same stream', () => {
    let found = 0;
    for (let nonce = 0; nonce < 3000 && found < 3; nonce += 1) {
      const r = playSlotRound(SANDS_OF_AURUM, rng(nonce, 'e5'));
      if (r.freeSpins.length > 0) {
        found += 1;
        expect(r.base.scatters).toBeGreaterThanOrEqual(3);
        expect(r.freeSpins.length).toBe(awardFor(SANDS_OF_AURUM, r.base.scatters));
      }
    }
    expect(found).toBe(3);
  });

  it('the risk profile matches the exact analysis', () => {
    const a = analyseMachine(LANTERN_HOLLOW);
    const risk = lanternHollow.assess(LANTERN_HOLLOW, { amount: 10_000 });
    expect(risk.expectedPayout).toBeCloseTo(a.meanE2 * 100, 6);
    expect(risk.maxPayout).toBe(Math.floor((10_000 * a.maxTotalE2) / 100));
    expect(risk.payoutVariance).toBeCloseTo(a.varE2 * 10_000, 0);
  });
});

describe('slot configuration and bets are validated', () => {
  it('rejects wilds on reel 1, unknown symbols, falling pays, and an RTP of 100% or more', () => {
    const bad = (patch: Partial<SlotConfig>) => slotConfigSchema.safeParse({ ...TINY, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ reels: [['w', ...TINY.reels[0]!], ...TINY.reels.slice(1)] })).toBe(false);
    expect(bad({ reels: [['zz', ...TINY.reels[0]!], ...TINY.reels.slice(1)] })).toBe(false);
    expect(bad({ symbols: TINY.symbols.map((s) => (s.id === 'h' ? { ...s, pays: [2, 1, 8] as [number, number, number] } : s)) })).toBe(false);
    expect(bad({ symbols: TINY.symbols.map((s) => (s.kind === 'low' ? { ...s, pays: [500, 900, 2000] as [number, number, number] } : s)) })).toBe(false);
  });

  it('accepts only a positive whole stake', () => {
    expect(slotBetSchema.safeParse({ amount: 100 }).success).toBe(true);
    expect(slotBetSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(slotBetSchema.safeParse({ amount: 1.5 }).success).toBe(false);
    expect(slotBetSchema.safeParse({ amount: 100, lines: 20 }).success).toBe(false);
  });
});
