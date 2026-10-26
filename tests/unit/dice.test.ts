import { describe, expect, it } from 'vitest';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import {
  dice,
  DICE_OUTCOMES,
  diceBetSchema,
  diceConfigSchema,
  diceRtp,
  diceWins,
  multiplierE4For,
  winCountFor,
} from '@/engine/games/dice';
import { GameRuleError } from '@/engine/games/types';

const config = dice.defaultConfig;

describe('dice', () => {
  it('maps targets and directions to win counts', () => {
    expect(winCountFor(4950, 'under')).toBe(4950);
    expect(winCountFor(5049, 'over')).toBe(4950);
    expect(winCountFor(100, 'under')).toBe(100);
  });

  it('win condition is strict at the boundary', () => {
    expect(diceWins(4949, 4950, 'under')).toBe(true);
    expect(diceWins(4950, 4950, 'under')).toBe(false);
    expect(diceWins(5050, 5049, 'over')).toBe(true);
    expect(diceWins(5049, 5049, 'over')).toBe(false);
  });

  it('exhaustively: the number of winning rolls equals winCount', () => {
    for (const [target, direction] of [
      [4950, 'under'],
      [5049, 'over'],
      [100, 'under'],
      [9899, 'over'],
      [9800, 'under'],
    ] as const) {
      let wins = 0;
      for (let roll = 0; roll < DICE_OUTCOMES; roll += 1) if (diceWins(roll, target, direction)) wins += 1;
      expect(wins).toBe(winCountFor(target, direction));
    }
  });

  it('documented multipliers', () => {
    expect(multiplierE4For(4950, 100)).toBe(20000); // 49.50% → 2.0000×
    expect(multiplierE4For(9800, 100)).toBe(10102); // 98% → 1.0102×
    expect(multiplierE4For(100, 100)).toBe(990000); // 1% → 99×
    expect(multiplierE4For(3300, 100)).toBe(30000); // 33% → 3.0000×
    expect(multiplierE4For(7000, 100)).toBe(14142); // 1.41428… → 1.4142×
  });

  it('RTP is ≤ 99% and > 98.99% for every permitted win chance', () => {
    let min = 1;
    let max = 0;
    for (let w = config.minWinCount; w <= config.maxWinCount; w += 1) {
      const rtp = diceRtp(w, config.houseEdgeBp);
      min = Math.min(min, rtp);
      max = Math.max(max, rtp);
    }
    expect(max).toBeLessThanOrEqual(0.99 + 1e-12);
    expect(min).toBeGreaterThan(0.9899);
  });

  it('exhaustive expected payout equals the assessed expectation (exact)', () => {
    const bet = { amount: 1234, target: 3300, direction: 'under' as const };
    const risk = dice.assess(config, bet);
    let total = 0;
    const winPayout = Math.floor((1234 * 30000) / 10000);
    for (let roll = 0; roll < DICE_OUTCOMES; roll += 1) total += diceWins(roll, 3300, 'under') ? winPayout : 0;
    expect(risk.maxPayout).toBe(winPayout);
    expect(risk.expectedPayout).toBeCloseTo(total / DICE_OUTCOMES, 9);
    expect(risk.expectedPayout / risk.stake).toBeLessThanOrEqual(0.99 + 1e-12);
  });

  it('payout is floored to the minor unit', () => {
    // 101 × 1.4142 = 142.8342 → 142
    const fairness = { serverSeed: '1'.repeat(64), clientSeed: 'c', nonce: 0 };
    const roll = new HmacRandomStream(fairness).nextInt(DICE_OUTCOMES);
    const res = dice.start(config, { amount: 101, target: 7000, direction: 'under' }, new HmacRandomStream(fairness));
    expect(res.state.roll).toBe(roll);
    expect(res.payout).toBe(roll < 7000 ? 142 : 0);
    expect(res.status).toBe('SETTLED');
  });

  it('rejects win chances outside the configured range', () => {
    expect(() => dice.assess(config, { amount: 100, target: 99, direction: 'under' })).toThrow(GameRuleError);
    expect(() => dice.assess(config, { amount: 100, target: 9801, direction: 'under' })).toThrow(GameRuleError);
    expect(() => dice.assess(config, { amount: 100, target: 9900, direction: 'over' })).toThrow(GameRuleError);
  });

  it('config schema refuses a non-positive house edge', () => {
    expect(diceConfigSchema.safeParse({ ...config, houseEdgeBp: 0 }).success).toBe(false);
    expect(diceConfigSchema.safeParse({ ...config, houseEdgeBp: -100 }).success).toBe(false);
    expect(diceConfigSchema.safeParse({ ...config, minWinCount: 9000, maxWinCount: 100 }).success).toBe(false);
    expect(diceConfigSchema.safeParse(config).success).toBe(true);
  });

  it('bet schema rejects malformed input', () => {
    expect(diceBetSchema.safeParse({ amount: 100, target: 5000, direction: 'under' }).success).toBe(true);
    expect(diceBetSchema.safeParse({ amount: 100, target: 50.5, direction: 'under' }).success).toBe(false);
    expect(diceBetSchema.safeParse({ amount: 100, target: 5000, direction: 'sideways' }).success).toBe(false);
    expect(diceBetSchema.safeParse({ amount: 0, target: 5000, direction: 'under' }).success).toBe(false);
    expect(diceBetSchema.safeParse({ amount: 100, target: 5000, direction: 'under', roll: 1 }).success).toBe(false);
  });
});
