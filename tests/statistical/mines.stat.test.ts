import { describe, expect, it } from 'vitest';
import { mines, strategyRtp, type MinesState } from '@/engine/games/mines';
import { chiSquareCritical, chiSquareStatistic, RunningStats } from '@/engine/stats';
import { streamFor } from './helpers';

const config = mines.defaultConfig;

describe('mines (statistical)', () => {
  it('every tile is equally likely to hold a mine (chi-square, 200k layouts)', () => {
    const counts = new Array<number>(25).fill(0);
    for (let nonce = 0; nonce < 200_000; nonce += 1) {
      for (const t of mines.start(config, { amount: 100, mines: 3 }, streamFor(nonce, 'mines-layout')).state.mines) counts[t]! += 1;
    }
    const chi = chiSquareStatistic(counts, new Array(25).fill(1 / 25));
    expect(chi).toBeLessThan(chiSquareCritical(24, 0.001));
  });

  it.each([
    [3, 3],
    [5, 2],
    [10, 1],
  ])('empirical RTP of "cash out after k picks" (m=%i, k=%i) is within a 99.9 percent CI of theory', (m, k) => {
    const stats = new RunningStats();
    for (let nonce = 0; nonce < 200_000; nonce += 1) {
      let state: MinesState = mines.start(config, { amount: 10_000, mines: m }, streamFor(nonce, `mines-${m}-${k}`)).state;
      let payout = 0;
      // Always pick the lowest-numbered unrevealed tile: tile choice must not matter.
      for (let pick = 0; pick < k; pick += 1) {
        const tile = Array.from({ length: 25 }, (_, i) => i).find((t) => !state.revealed.includes(t))!;
        const step = mines.act(config, state, { type: 'reveal', tile }, { elapsedMs: 0 });
        state = step.state;
        if (step.status === 'SETTLED') {
          payout = step.payout;
          break;
        }
      }
      if (state.status === 'playing') payout = mines.act(config, state, { type: 'cashout' }, { elapsedMs: 0 }).payout;
      stats.push(payout / 10_000);
    }
    const theory = strategyRtp(config, m, k);
    const [lo, hi] = stats.ci(0.999);
    expect(lo).toBeLessThan(theory);
    expect(hi).toBeGreaterThan(theory);
  });
});
