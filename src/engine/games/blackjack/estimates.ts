/**
 * House-edge ESTIMATES for every supported rule set, produced by
 * `npm run sim:game -- blackjack --all` (basic strategy, fresh shoe each hand,
 * no insurance). Values are per initial wager; ci95 is the 95% confidence
 * interval of the house edge; variancePerUnit is the variance of the net
 * result per unit of initial wager. Regenerate after any rule change.
 */
export interface EdgeEstimate {
  houseEdge: number;
  ci95: [number, number];
  variancePerUnit: number;
  hands: number;
}

type Key = `${6 | 8}-${'S17' | 'H17'}-${'3:2' | '6:5'}-${'DAS' | 'NDAS'}`;

// GENERATED-ESTIMATES-START
export const ESTIMATES: Partial<Record<Key, EdgeEstimate>> = {};
// GENERATED-ESTIMATES-END

export function estimateKey(c: { decks: number; dealerHitsSoft17: boolean; blackjackPays: string; doubleAfterSplit: boolean }): Key {
  return `${c.decks as 6 | 8}-${c.dealerHitsSoft17 ? 'H17' : 'S17'}-${c.blackjackPays as '3:2' | '6:5'}-${c.doubleAfterSplit ? 'DAS' : 'NDAS'}`;
}

/**
 * Estimate for analytics expectations. Falls back to literature values
 * (edge 0.5%, variance 1.3 per unit) only for a rule set not yet simulated —
 * such a configuration cannot be published, because theoretical() is strict.
 */
export function analyticsEstimate(c: { decks: number; dealerHitsSoft17: boolean; blackjackPays: string; doubleAfterSplit: boolean }): Pick<EdgeEstimate, 'houseEdge' | 'variancePerUnit'> {
  return ESTIMATES[estimateKey(c)] ?? { houseEdge: 0.005, variancePerUnit: 1.3 };
}

export function estimateFor(c: { decks: number; dealerHitsSoft17: boolean; blackjackPays: string; doubleAfterSplit: boolean }): EdgeEstimate {
  const e = ESTIMATES[estimateKey(c)];
  if (!e) throw new Error(`no simulated house-edge estimate for blackjack rules ${estimateKey(c)}; run the simulation first`);
  return e;
}
