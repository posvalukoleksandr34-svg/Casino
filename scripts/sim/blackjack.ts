import { allowedActions, applyAction, dealFromShoe, type BlackjackConfig, type BlackjackState } from '../../src/engine/games/blackjack';
import { basicStrategy } from '../../src/engine/games/blackjack/strategy';
import { SimulationRandom } from '../../src/engine/rng/sim-random';
import type { StepResult } from '../../src/engine/games/types';

export interface BjSums {
  hands: number;
  sum: number; // Σ net result per unit of initial wager
  sumSq: number;
  wins: number;
  pushes: number;
  losses: number;
  blackjacks: number;
  doubles: number;
  splits: number;
}

const UNIT = 1_000_000; // stake in minor units (large, so payout rounding is negligible)
const PREFIX = 100; // a round can never consume more than ~60 cards

/** Uniformly random prefix of a shuffled shoe (front-to-back Fisher–Yates). */
function shoePrefix(rng: SimulationRandom, size: number): number[] {
  const deck = Array.from({ length: size }, (_, i) => i);
  for (let i = 0; i < PREFIX; i += 1) {
    const j = i + rng.nextInt(size - i);
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
  return deck;
}

/** Plays `hands` rounds of basic strategy (never insurance) through the production engine. */
export function simulateBlackjack(config: BlackjackConfig, hands: number, seed: [number, number, number, number]): BjSums {
  const rng = new SimulationRandom(seed);
  const sums: BjSums = { hands: 0, sum: 0, sumSq: 0, wins: 0, pushes: 0, losses: 0, blackjacks: 0, doubles: 0, splits: 0 };
  for (let n = 0; n < hands; n += 1) {
    let step: StepResult<BlackjackState> = dealFromShoe(config, { amount: UNIT }, shoePrefix(rng, 52 * config.decks));
    let staked = UNIT;
    while (step.status === 'OPEN') {
      const s = step.state;
      if (s.phase === 'insurance') {
        step = applyAction(config, s, { type: 'insurance', take: false });
        continue;
      }
      const type = basicStrategy(s.hands[s.active]!.cards, s.dealer[0]!, allowedActions(config, s), config) as 'hit' | 'stand' | 'double' | 'split';
      if (type === 'double') sums.doubles += 1;
      if (type === 'split') sums.splits += 1;
      step = applyAction(config, s, { type });
      for (const e of step.additionalStakes) staked += e.amount;
    }
    const net = (step.payout - staked) / UNIT;
    sums.hands += 1;
    sums.sum += net;
    sums.sumSq += net * net;
    if (net > 0) sums.wins += 1;
    else if (net < 0) sums.losses += 1;
    else sums.pushes += 1;
    if (step.state.results?.some((r) => r.outcome === 'blackjack')) sums.blackjacks += 1;
  }
  return sums;
}
