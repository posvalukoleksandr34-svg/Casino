import { describe, expect, it } from 'vitest';
import { hilo, HILO_CARDS, hiloStrategyRtp, likelierSide, rankOf, type HiloState } from '@/engine/games/hilo';
import { drawKeno, kenoHitProbability } from '@/engine/games/keno';
import { limbo, limboWinProbability } from '@/engine/games/limbo';
import { dropPath, plinkoSlotProbability } from '@/engine/games/plinko';
import { chiSquareCritical, chiSquareStatistic, RunningStats } from '@/engine/stats';
import { streamFor } from './helpers';

const ALPHA = 0.001;

describe('keno (statistical)', () => {
  const N = 100_000;
  const draws = Array.from({ length: N }, (_, nonce) => drawKeno(streamFor(nonce, 'keno')));

  it('every number 1–40 is drawn with probability 1/4 (chi-square over 40 numbers)', () => {
    const counts = new Array<number>(40).fill(0);
    for (const d of draws) for (const x of d) counts[x - 1]! += 1;
    // Each draw contributes 10 numbers; as a distribution over numbers each has share 1/40.
    expect(chiSquareStatistic(counts, new Array(40).fill(1 / 40))).toBeLessThan(chiSquareCritical(39, ALPHA));
  });

  it('hits for 5 picks follow the hypergeometric distribution', () => {
    const picks = [3, 11, 19, 27, 35];
    const counts = new Array<number>(6).fill(0);
    for (const d of draws) counts[picks.filter((p) => d.includes(p)).length]! += 1;
    // Merge 4 and 5 hits (expected counts below 5 otherwise).
    const observed = [counts[0]!, counts[1]!, counts[2]!, counts[3]!, counts[4]! + counts[5]!];
    const p = [0, 1, 2, 3].map((k) => kenoHitProbability(5, k));
    p.push(kenoHitProbability(5, 4) + kenoHitProbability(5, 5));
    expect(chiSquareStatistic(observed, p)).toBeLessThan(chiSquareCritical(4, ALPHA));
  });
});

describe('plinko (statistical)', () => {
  it('16-row slots follow Binomial(16, 1/2) (tails merged)', () => {
    const N = 200_000;
    const counts = new Array<number>(17).fill(0);
    for (let nonce = 0; nonce < N; nonce += 1) counts[dropPath(16, streamFor(nonce, 'plinko')).reduce((a, b) => a + b, 0)]! += 1;
    const merge = (xs: number[]) => [xs.slice(0, 3).reduce((a, b) => a + b, 0), ...xs.slice(3, 14), xs.slice(14).reduce((a, b) => a + b, 0)];
    const p = Array.from({ length: 17 }, (_, k) => plinkoSlotProbability(16, k));
    expect(chiSquareStatistic(merge(counts), merge(p))).toBeLessThan(chiSquareCritical(12, ALPHA));
  });
});

describe('limbo (statistical)', () => {
  it('RTP at 2× is within a 99.9% CI of 99%, and P(win) matches the exact value', () => {
    const N = 300_000;
    const stats = new RunningStats();
    let wins = 0;
    for (let nonce = 0; nonce < N; nonce += 1) {
      const step = limbo.start(limbo.defaultConfig, { amount: 10_000, targetE2: 200 }, streamFor(nonce, 'limbo'));
      stats.push(step.payout / 10_000);
      if (step.state.won) wins += 1;
    }
    const [lo, hi] = stats.ci(0.999);
    expect(lo).toBeLessThan(0.99);
    expect(hi).toBeGreaterThan(0.99);
    const p = limboWinProbability(200, 100);
    expect(Math.abs(wins / N - p)).toBeLessThan(3.3 * Math.sqrt((p * (1 - p)) / N));
  });
});

describe('hi-lo (statistical)', () => {
  it('card ranks are uniform on 1–13 across the whole pre-drawn sequence', () => {
    const counts = new Array<number>(13).fill(0);
    for (let nonce = 0; nonce < 5_000; nonce += 1) {
      const s = hilo.start(hilo.defaultConfig, { amount: 100 }, streamFor(nonce, 'hilo')).state;
      for (const c of s.sequence) {
        expect(c >= 0 && c < HILO_CARDS).toBe(true);
        counts[rankOf(c) - 1]! += 1;
      }
    }
    expect(chiSquareStatistic(counts, new Array(13).fill(1 / 13))).toBeLessThan(chiSquareCritical(12, ALPHA));
  });

  it('"likelier side, cash out after 2" returns its exact RTP within a 99.9% CI', () => {
    const c = hilo.defaultConfig;
    const stats = new RunningStats();
    for (let nonce = 0; nonce < 200_000; nonce += 1) {
      let step = hilo.start(c, { amount: 10_000 }, streamFor(nonce, 'hilo-rtp'));
      while (step.status === 'OPEN' && step.state.factors.length < 2) {
        const s: HiloState = step.state;
        step = hilo.act(c, s, { type: 'guess', direction: likelierSide(rankOf(s.sequence[s.position]!)) }, { elapsedMs: 0 });
      }
      if (step.status === 'OPEN') step = hilo.act(c, step.state, { type: 'cashout' }, { elapsedMs: 0 });
      stats.push(step.payout / 10_000);
    }
    const [lo, hi] = stats.ci(0.999);
    const rtp = hiloStrategyRtp(c, 2);
    expect(lo).toBeLessThan(rtp);
    expect(hi).toBeGreaterThan(rtp);
  });
});
