import { describe, expect, it } from 'vitest';
import { dice, DICE_OUTCOMES } from '@/engine/games/dice';
import { roulette } from '@/engine/games/roulette';
import { chiSquareCritical, chiSquareStatistic, RunningStats } from '@/engine/stats';
import { streamFor } from './helpers';

/*
 * These are sanity checks, not proofs of randomness: they would catch gross
 * defects such as modulo bias, an off-by-one in the outcome range or a payout
 * formula that disagrees with the documented RTP. Seeds are fixed, so results
 * are reproducible. Significance level α = 0.001.
 */
const ALPHA = 0.001;

describe('roulette (statistical)', () => {
  const N = 370_000;

  it('pocket frequencies are consistent with a uniform distribution (chi-square)', () => {
    const counts = new Array<number>(37).fill(0);
    for (let nonce = 0; nonce < N; nonce += 1) counts[streamFor(nonce).nextInt(37)]! += 1;
    const chi = chiSquareStatistic(counts, new Array(37).fill(1 / 37));
    const critical = chiSquareCritical(36, ALPHA);
    console.info(`roulette chi-square = ${chi.toFixed(2)} (critical ${critical.toFixed(2)} at α=${ALPHA}, df=36)`);
    expect(chi).toBeLessThan(critical);
  });

  it('empirical RTP of a mixed bet slip is within a 99.9% CI of 36/37', () => {
    const bets = {
      bets: [
        { type: 'straight' as const, number: 17, amount: 100 },
        { type: 'red' as const, amount: 100 },
        { type: 'dozen' as const, index: 3 as const, amount: 100 },
      ],
    };
    const stats = new RunningStats();
    for (let nonce = 0; nonce < N; nonce += 1) {
      const r = roulette.start(roulette.defaultConfig, bets, streamFor(nonce, 'rtp'));
      stats.push(r.payout / 300);
    }
    const [lo, hi] = stats.ci(0.999);
    console.info(`roulette RTP = ${(stats.mean * 100).toFixed(3)}% (99.9% CI ${(lo * 100).toFixed(3)}–${(hi * 100).toFixed(3)}%, theory 97.297%)`);
    expect(lo).toBeLessThan(36 / 37);
    expect(hi).toBeGreaterThan(36 / 37);
  });
});

describe('dice (statistical)', () => {
  const N = 500_000;

  it('rolls are uniform over 100 buckets (chi-square)', () => {
    const counts = new Array<number>(100).fill(0);
    for (let nonce = 0; nonce < N; nonce += 1) counts[Math.floor(streamFor(nonce, 'dice').nextInt(DICE_OUTCOMES) / 100)]! += 1;
    const chi = chiSquareStatistic(counts, new Array(100).fill(1 / 100));
    const critical = chiSquareCritical(99, ALPHA);
    console.info(`dice chi-square = ${chi.toFixed(2)} (critical ${critical.toFixed(2)} at α=${ALPHA}, df=99)`);
    expect(chi).toBeLessThan(critical);
  });

  it.each([
    [4950, 'under'],
    [1000, 'over'],
    [500, 'under'],
  ] as const)('empirical RTP for target %i %s is within a 99.9 percent CI of theory', (target, direction) => {
    const bet = { amount: 10_000, target, direction };
    const theory = dice.assess(dice.defaultConfig, bet).expectedPayout / bet.amount;
    const stats = new RunningStats();
    for (let nonce = 0; nonce < N; nonce += 1) {
      stats.push(dice.start(dice.defaultConfig, bet, streamFor(nonce, `dice-${target}-${direction}`)).payout / bet.amount);
    }
    const [lo, hi] = stats.ci(0.999);
    console.info(`dice ${target} ${direction}: RTP ${(stats.mean * 100).toFixed(3)}% CI [${(lo * 100).toFixed(3)}, ${(hi * 100).toFixed(3)}] theory ${(theory * 100).toFixed(3)}%`);
    expect(lo).toBeLessThan(theory);
    expect(hi).toBeGreaterThan(theory);
  });
});
