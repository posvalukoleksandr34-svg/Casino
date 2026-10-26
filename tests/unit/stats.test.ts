import { describe, expect, it } from 'vitest';
import { chiSquareCritical, normalCdf, normalQuantile, payoutZScore, RunningStats, twoSidedP } from '@/engine/stats';

describe('stats helpers', () => {
  it('normal quantile/cdf match reference values', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.9995)).toBeCloseTo(3.290527, 5);
    expect(normalQuantile(0.01)).toBeCloseTo(-2.326348, 5);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(twoSidedP(1.959964)).toBeCloseTo(0.05, 4);
  });

  it('chi-square critical values approximate tables', () => {
    expect(chiSquareCritical(36, 0.001)).toBeCloseTo(67.985, 0);
    expect(chiSquareCritical(99, 0.001)).toBeCloseTo(148.23, 0);
  });

  it('running stats', () => {
    const s = new RunningStats();
    [2, 4, 4, 4, 5, 5, 7, 9].forEach((x) => s.push(x));
    expect(s.mean).toBe(5);
    expect(s.variance).toBeCloseTo(32 / 7, 10);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
  });

  it('z-score', () => {
    expect(payoutZScore(110, 100, 25)).toBe(2);
    expect(payoutZScore(1, 1, 0)).toBeNull();
  });
});
