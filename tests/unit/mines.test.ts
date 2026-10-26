import { describe, expect, it } from 'vitest';
import { binomial } from '@/engine/combinatorics';
import { maxPicks, mines, multiplierE4, strategyRtp, survivalProbability, type MinesState } from '@/engine/games/mines';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { GameRuleError } from '@/engine/games/types';
import { verifyOutcome } from '@/engine/verify';

const config = mines.defaultConfig;
const rng = (nonce = 0) => new HmacRandomStream({ serverSeed: 'd'.repeat(64), clientSeed: 'mines', nonce });

describe('mines mathematics', () => {
  it('binomial coefficients', () => {
    expect(binomial(25, 0)).toBe(1n);
    expect(binomial(25, 3)).toBe(2300n);
    expect(binomial(25, 12)).toBe(5_200_300n);
    expect(binomial(5, 7)).toBe(0n);
  });

  it('survival probability is the product of conditional probabilities', () => {
    for (const m of [1, 3, 10, 24]) {
      let p = 1;
      for (let k = 1; k <= 25 - m; k += 1) {
        p *= (25 - m - (k - 1)) / (25 - (k - 1));
        expect(survivalProbability(m, k)).toBeCloseTo(p, 12);
      }
    }
  });

  it('documented multipliers', () => {
    expect(multiplierE4(config, 1, 1)).toBe(10_312); // 0.99 × 25/24 = 1.03125 → 1.0312
    expect(multiplierE4(config, 3, 1)).toBe(11_250); // 0.99 × 25/22
    expect(multiplierE4(config, 24, 1)).toBe(247_500); // 0.99 × 25 = 24.75
    expect(multiplierE4(config, 3, 22)).toBe(10_000_000); // 0.99 × 2300 = 2277 → capped at 1,000×
  });

  it('every stopping point has RTP ≤ 1 − edge and within 0.0001 of it below the cap', () => {
    for (let m = 1; m <= 24; m += 1) {
      for (let k = 1; k <= maxPicks(config, m); k += 1) {
        const rtp = strategyRtp(config, m, k);
        expect(rtp).toBeLessThanOrEqual(0.99 + 1e-12);
        if (multiplierE4(config, m, k) < config.maxMultiplierE4) expect(rtp).toBeGreaterThan(0.99 - 1e-4);
      }
    }
  });

  it('maxPicks stops at all-safe or at the cap', () => {
    expect(maxPicks(config, 24)).toBe(1);
    expect(maxPicks(config, 1)).toBe(24);
    const k = maxPicks(config, 5);
    expect(multiplierE4(config, 5, k)).toBe(config.maxMultiplierE4);
    expect(multiplierE4(config, 5, k - 1)).toBeLessThan(config.maxMultiplierE4);
  });
});

describe('mines round lifecycle', () => {
  it('places the requested number of distinct mines and hides them while playing', () => {
    const r = mines.start(config, { amount: 1000, mines: 5 }, rng(1));
    expect(r.status).toBe('OPEN');
    expect(new Set(r.state.mines).size).toBe(5);
    expect(r.state.mines.every((t) => t >= 0 && t < 25)).toBe(true);
    expect(mines.view(config, r.state, false).mines).toBeNull();
    expect(mines.view(config, r.state, true).mines).toEqual(r.state.mines);
  });

  it('safe reveals raise the multiplier; cash-out pays stake × multiplier', () => {
    const r = mines.start(config, { amount: 1000, mines: 3 }, rng(2));
    const safe = Array.from({ length: 25 }, (_, i) => i).filter((t) => !r.state.mines.includes(t));
    let s: MinesState = r.state;
    for (let i = 0; i < 3; i += 1) {
      const step = mines.act(config, s, { type: 'reveal', tile: safe[i]! }, { elapsedMs: 0 });
      expect(step.status).toBe('OPEN');
      s = step.state;
      expect(s.multiplierE4).toBe(multiplierE4(config, 3, i + 1));
    }
    const out = mines.act(config, s, { type: 'cashout' }, { elapsedMs: 0 });
    expect(out.status).toBe('SETTLED');
    expect(out.payout).toBe(Math.floor((1000 * multiplierE4(config, 3, 3)) / 10_000));
    expect(out.payout).toBeLessThanOrEqual(out.risk.maxPayout);
  });

  it('hitting a mine settles at zero', () => {
    const r = mines.start(config, { amount: 1000, mines: 3 }, rng(3));
    const out = mines.act(config, r.state, { type: 'reveal', tile: r.state.mines[0]! }, { elapsedMs: 0 });
    expect(out.status).toBe('SETTLED');
    expect(out.payout).toBe(0);
    expect(out.state.hitMine).toBe(r.state.mines[0]);
  });

  it('finding every safe tile settles automatically', () => {
    const r = mines.start(config, { amount: 100, mines: 24 }, rng(4));
    const safe = Array.from({ length: 25 }, (_, i) => i).find((t) => !r.state.mines.includes(t))!;
    const out = mines.act(config, r.state, { type: 'reveal', tile: safe }, { elapsedMs: 0 });
    expect(out.status).toBe('SETTLED');
    expect(out.payout).toBe(Math.floor((100 * 247_500) / 10_000));
  });

  it('rejects invalid actions', () => {
    const r = mines.start(config, { amount: 100, mines: 3 }, rng(5));
    expect(() => mines.act(config, r.state, { type: 'cashout' }, { elapsedMs: 0 })).toThrow(GameRuleError);
    const safe = Array.from({ length: 25 }, (_, i) => i).find((t) => !r.state.mines.includes(t))!;
    const s = mines.act(config, r.state, { type: 'reveal', tile: safe }, { elapsedMs: 0 }).state;
    expect(() => mines.act(config, s, { type: 'reveal', tile: safe }, { elapsedMs: 0 })).toThrow(GameRuleError);
    expect(mines.actionSchema!.safeParse({ type: 'reveal', tile: 25 }).success).toBe(false);
    expect(() => mines.assess({ ...config, maxMines: 10 }, { amount: 100, mines: 11 })).toThrow(GameRuleError);
  });

  it('verifier reproduces the mine positions', () => {
    for (let nonce = 0; nonce < 50; nonce += 1) {
      const r = mines.start(config, { amount: 100, mines: 7 }, rng(nonce));
      const v = verifyOutcome('mines', { serverSeed: 'd'.repeat(64), clientSeed: 'mines', nonce }, { mines: 7 });
      expect(v.outcome.mines).toEqual(r.state.mines);
    }
  });
});
