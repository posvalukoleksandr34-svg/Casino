import { describe, expect, it } from 'vitest';
import { drawCrashPoint, survivalAt } from '@/engine/games/crash';
import { chiSquareCritical, chiSquareStatistic, RunningStats } from '@/engine/stats';
import { streamFor } from './helpers';

describe('crash (statistical)', () => {
  const N = 500_000;
  const points: number[] = [];
  for (let nonce = 0; nonce < N; nonce += 1) points.push(drawCrashPoint(streamFor(nonce, 'crash'), 100));

  it('crash-point tail frequencies match P(crash ≥ x) = 0.99/x (chi-square over bins)', () => {
    const edges = [100, 101, 120, 150, 200, 300, 500, 1000, 3000, Infinity];
    const observed = new Array<number>(edges.length - 1).fill(0);
    for (const p of points) {
      for (let i = 0; i < edges.length - 1; i += 1) {
        if (p >= edges[i]! && p < edges[i + 1]!) {
          observed[i]! += 1;
          break;
        }
      }
    }
    const tail = (x: number) => (x === 100 ? 1 : x === Infinity ? 0 : survivalAt(x, 100));
    const expected = edges.slice(0, -1).map((x, i) => tail(x) - tail(edges[i + 1]!));
    const chi = chiSquareStatistic(observed, expected);
    expect(chi).toBeLessThan(chiSquareCritical(expected.length - 1, 0.001));
  });

  it.each([110, 200, 1000])('RTP of automatic target %i/100 is within a 99.9 percent CI of 99 percent', (x) => {
    const stats = new RunningStats();
    for (const p of points) stats.push(p >= x ? x / 100 : 0);
    const [lo, hi] = stats.ci(0.999);
    expect(lo).toBeLessThan(0.99);
    expect(hi).toBeGreaterThan(0.99);
  });

  it('an instant crash (1.00×) happens with probability 1 − 0.99/1.01 ≈ 1.98%', () => {
    const share = points.filter((p) => p === 100).length / N;
    const p = 1 - 0.99 / 1.01;
    const se = Math.sqrt((p * (1 - p)) / N);
    expect(Math.abs(share - p)).toBeLessThan(3.3 * se);
  });
});
