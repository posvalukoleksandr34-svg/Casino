import { describe, expect, it } from 'vitest';
import { allowedActions, applyAction, blackjack, isBlackjack, rankOf, type BlackjackState } from '@/engine/games/blackjack';
import { estimateFor } from '@/engine/games/blackjack/estimates';
import { basicStrategy } from '@/engine/games/blackjack/strategy';
import type { StepResult } from '@/engine/games/types';
import { chiSquareCritical, chiSquareStatistic, RunningStats } from '@/engine/stats';
import { streamFor } from './helpers';

/**
 * Plays basic strategy through the production code path (provably fair HMAC
 * stream → full-shoe Fisher–Yates → engine), independently of the simulation
 * PRNG used to produce the published estimate.
 */
describe('blackjack (statistical)', () => {
  const config = blackjack.defaultConfig;
  const N = 120_000;
  const UNIT = 100_000;
  const net = new RunningStats();
  let naturals = 0;
  const upRanks = new Array<number>(13).fill(0);
  for (let nonce = 0; nonce < N; nonce += 1) {
    let step: StepResult<BlackjackState> = blackjack.start(config, { amount: UNIT }, streamFor(nonce, 'blackjack'));
    let staked = UNIT;
    upRanks[rankOf(step.state.dealer[0]!)]! += 1;
    if (isBlackjack(step.state.hands[0]!.cards)) naturals += 1;
    while (step.status === 'OPEN') {
      const s = step.state;
      const type = s.phase === 'insurance' ? null : (basicStrategy(s.hands[s.active]!.cards, s.dealer[0]!, allowedActions(config, s), config) as 'hit' | 'stand' | 'double' | 'split');
      step = type === null ? applyAction(config, s, { type: 'insurance', take: false }) : applyAction(config, s, { type });
      for (const e of step.additionalStakes) staked += e.amount;
    }
    net.push((step.payout - staked) / UNIT);
  }

  it('dealer up-card ranks are uniform (chi-square, 12 df)', () => {
    const chi = chiSquareStatistic(upRanks, new Array(13).fill(1 / 13));
    expect(chi).toBeLessThan(chiSquareCritical(12, 0.001));
  });

  it('player naturals occur with probability 2 · (4d/52d) · (16d/(52d − 1))', () => {
    const d = config.decks;
    const p = 2 * ((4 * d) / (52 * d)) * ((16 * d) / (52 * d - 1));
    const se = Math.sqrt((p * (1 - p)) / N);
    expect(Math.abs(naturals / N - p)).toBeLessThan(3.3 * se);
  });

  it('realised edge under basic strategy agrees with the published estimate (99.9% CI)', () => {
    const est = estimateFor(config);
    const [lo, hi] = net.ci(0.999);
    expect(lo).toBeLessThan(-est.houseEdge);
    expect(hi).toBeGreaterThan(-est.houseEdge);
    expect(net.variance).toBeGreaterThan(est.variancePerUnit * 0.95);
    expect(net.variance).toBeLessThan(est.variancePerUnit * 1.05);
  });
});
