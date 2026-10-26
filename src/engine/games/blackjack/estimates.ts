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

// GENERATED-ESTIMATES-START (2026-10-26, npm run sim:game -- blackjack --all --write)
export const ESTIMATES: Partial<Record<Key, EdgeEstimate>> = {
  '6-S17-3:2-DAS': { houseEdge: 0.004191, ci95: [0.003791, 0.004591], variancePerUnit: 1.3316, hands: 32000000 },
  '6-S17-3:2-NDAS': { houseEdge: 0.005445, ci95: [0.004659, 0.006231], variancePerUnit: 1.2868, hands: 8000000 },
  '6-S17-6:5-DAS': { houseEdge: 0.017591, ci95: [0.016803, 0.018380], variancePerUnit: 1.2942, hands: 8000000 },
  '6-S17-6:5-NDAS': { houseEdge: 0.019249, ci95: [0.018474, 0.020024], variancePerUnit: 1.2498, hands: 8000000 },
  '6-H17-3:2-DAS': { houseEdge: 0.005724, ci95: [0.004920, 0.006528], variancePerUnit: 1.3466, hands: 8000000 },
  '6-H17-3:2-NDAS': { houseEdge: 0.007698, ci95: [0.006908, 0.008489], variancePerUnit: 1.2999, hands: 8000000 },
  '6-H17-6:5-DAS': { houseEdge: 0.019150, ci95: [0.018357, 0.019943], variancePerUnit: 1.3094, hands: 8000000 },
  '6-H17-6:5-NDAS': { houseEdge: 0.022232, ci95: [0.021453, 0.023010], variancePerUnit: 1.2629, hands: 8000000 },
  '8-S17-3:2-DAS': { houseEdge: 0.004273, ci95: [0.003473, 0.005073], variancePerUnit: 1.3329, hands: 8000000 },
  '8-S17-3:2-NDAS': { houseEdge: 0.006662, ci95: [0.005876, 0.007448], variancePerUnit: 1.2870, hands: 8000000 },
  '8-S17-6:5-DAS': { houseEdge: 0.017863, ci95: [0.017074, 0.018652], variancePerUnit: 1.2961, hands: 8000000 },
  '8-S17-6:5-NDAS': { houseEdge: 0.019000, ci95: [0.018226, 0.019775], variancePerUnit: 1.2506, hands: 8000000 },
  '8-H17-3:2-DAS': { houseEdge: 0.006224, ci95: [0.005419, 0.007028], variancePerUnit: 1.3468, hands: 8000000 },
  '8-H17-3:2-NDAS': { houseEdge: 0.008217, ci95: [0.007426, 0.009007], variancePerUnit: 1.3006, hands: 8000000 },
  '8-H17-6:5-DAS': { houseEdge: 0.019861, ci95: [0.019068, 0.020654], variancePerUnit: 1.3106, hands: 8000000 },
  '8-H17-6:5-NDAS': { houseEdge: 0.021431, ci95: [0.020652, 0.022210], variancePerUnit: 1.2637, hands: 8000000 },
};
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
