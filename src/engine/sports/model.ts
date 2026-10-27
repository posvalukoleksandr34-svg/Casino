/**
 * Sports prediction maths (pure; shared by server, tests and the browser
 * verifier).
 *
 * Demo events use an original, published score model: home and away goals are
 * independent Poisson variables (λ from fictional team ratings), tabulated as
 * integer weights for every scoreline 0–9 : 0–9. Prices and the simulated
 * result come from the same integer table:
 *
 *   P(outcome)  = W_outcome / W                    (exact rational)
 *   odds        = ⌊100 · W · 10⁴ / (W_outcome · (10⁴ + margin))⌋ / 100
 *   RTP(outcome)= P(outcome) · odds ≤ 1 / (1 + margin)     (94.34 % at 6 %)
 *   result      = the scoreline at u = rng.nextInt(W) in the cumulative table,
 *                 rng = HMAC stream of the event's committed seed.
 *
 * Settlement: a winning selection returns ⌊stake · odds⌋ (stake included); a
 * void returns the stake. Result corrections only ever credit the difference
 * to a higher entitlement (see `correctionCredit`).
 */
import { mulDivFloor } from '../money';
import type { RandomSource } from '../rng/provably-fair';

export type Outcome = 'HOME' | 'DRAW' | 'AWAY';
export const OUTCOMES: Outcome[] = ['HOME', 'DRAW', 'AWAY'];
export const OUTCOME_LABELS: Record<Outcome, string> = { HOME: '1 · Home win', DRAW: 'X · Draw', AWAY: '2 · Away win' };

/** Goals per side tabulated by the demo model (0 … 9). */
export const SCORE_GRID = 10;
/** Integer scale of the tabulated probabilities. */
export const WEIGHT_SCALE = 1_000_000_000;
/** Demo pricing margin in basis points (6 % overround on each selection). */
export const DEMO_MARGIN_BP = 600;
export const MIN_ODDS_E2 = 101;
export const MAX_ODDS_E2 = 100_000;

export interface ScoreModel {
  /** Expected goals ×1000 (published for transparency). */
  lambdaHomeE3: number;
  lambdaAwayE3: number;
  /** Row-major weights: index = home × SCORE_GRID + away. */
  weights: number[];
  marginBp: number;
}

export function outcomeOf(home: number, away: number): Outcome {
  return home > away ? 'HOME' : home < away ? 'AWAY' : 'DRAW';
}

function poissonPmf(lambda: number, max: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k < max; k += 1) {
    out.push(p);
    p = (p * lambda) / (k + 1);
  }
  return out;
}

/** Builds the integer score table for expected goals (λ ×1000). Computed once on the server and stored with the event. */
export function buildScoreModel(lambdaHomeE3: number, lambdaAwayE3: number, marginBp = DEMO_MARGIN_BP): ScoreModel {
  if (!Number.isInteger(lambdaHomeE3) || !Number.isInteger(lambdaAwayE3) || lambdaHomeE3 < 100 || lambdaAwayE3 < 100 || lambdaHomeE3 > 6000 || lambdaAwayE3 > 6000) {
    throw new RangeError('expected goals must be between 0.1 and 6.0');
  }
  const h = poissonPmf(lambdaHomeE3 / 1000, SCORE_GRID);
  const a = poissonPmf(lambdaAwayE3 / 1000, SCORE_GRID);
  const weights: number[] = [];
  for (let i = 0; i < SCORE_GRID; i += 1) {
    for (let j = 0; j < SCORE_GRID; j += 1) weights.push(Math.round(h[i]! * a[j]! * WEIGHT_SCALE));
  }
  return { lambdaHomeE3, lambdaAwayE3, weights, marginBp };
}

export function validateScoreModel(m: ScoreModel): void {
  if (!Array.isArray(m.weights) || m.weights.length !== SCORE_GRID * SCORE_GRID) throw new Error('score model needs 100 weights');
  if (!m.weights.every((w) => Number.isSafeInteger(w) && w >= 0)) throw new Error('score model weights must be non-negative integers');
  if (totalWeight(m) <= 0 || totalWeight(m) > 2 ** 32) throw new Error('score model total weight out of range');
  if (!Number.isInteger(m.marginBp) || m.marginBp < 0 || m.marginBp > 5000) throw new Error('invalid margin');
}

export function totalWeight(m: Pick<ScoreModel, 'weights'>): number {
  return m.weights.reduce((s, w) => s + w, 0);
}

export function outcomeWeights(m: Pick<ScoreModel, 'weights'>): Record<Outcome, number> {
  const out: Record<Outcome, number> = { HOME: 0, DRAW: 0, AWAY: 0 };
  m.weights.forEach((w, idx) => {
    out[outcomeOf(Math.floor(idx / SCORE_GRID), idx % SCORE_GRID)] += w;
  });
  return out;
}

/** Demo decimal odds ×100 for an outcome, or null when the price would fall below 1.01 (not offered). */
export function priceOutcome(outcomeWeight: number, total: number, marginBp: number): number | null {
  if (outcomeWeight <= 0) return null;
  const odds = (BigInt(total) * 100n * 10_000n) / (BigInt(outcomeWeight) * BigInt(10_000 + marginBp));
  const e2 = Number(odds);
  if (e2 < MIN_ODDS_E2) return null;
  return Math.min(e2, MAX_ODDS_E2);
}

export function demoPrices(m: ScoreModel): Record<Outcome, number | null> {
  const w = outcomeWeights(m);
  const total = totalWeight(m);
  return { HOME: priceOutcome(w.HOME, total, m.marginBp), DRAW: priceOutcome(w.DRAW, total, m.marginBp), AWAY: priceOutcome(w.AWAY, total, m.marginBp) };
}

/** Exact long-run return of backing `outcome` at `oddsE2` under the model. */
export function selectionRtp(m: ScoreModel, outcome: Outcome, oddsE2: number): number {
  return (outcomeWeights(m)[outcome] / totalWeight(m)) * (oddsE2 / 100);
}

/** The simulated full-time score: one draw from the committed stream over the published table. */
export function drawScore(m: Pick<ScoreModel, 'weights'>, rng: RandomSource): { home: number; away: number } {
  const total = totalWeight(m);
  let u = rng.nextInt(total);
  for (let idx = 0; idx < m.weights.length; idx += 1) {
    const w = m.weights[idx]!;
    if (u < w) return { home: Math.floor(idx / SCORE_GRID), away: idx % SCORE_GRID };
    u -= w;
  }
  throw new Error('unreachable: draw beyond total weight');
}

/** Client seed used for a demo event's stream (the event id binds the seed to this event). */
export const demoClientSeed = (eventId: string) => `sports-demo-${eventId}`;

/** Gross return of a winning ticket: ⌊stake × odds⌋ in minor units, stake included. */
export function potentialReturn(stake: number, oddsE2: number): number {
  return mulDivFloor(stake, oddsE2, 100);
}

export type ResultForSettlement = { kind: 'RESULT'; home: number; away: number } | { kind: 'VOID' };

/** Outcome and entitlement of a ticket under one result version. */
export function settleTicket(
  ticket: { selectionCode: Outcome; stake: number; potentialReturn: number },
  result: ResultForSettlement,
): { outcome: 'WON' | 'LOST' | 'VOIDED'; entitlement: number } {
  if (result.kind === 'VOID') return { outcome: 'VOIDED', entitlement: ticket.stake };
  return outcomeOf(result.home, result.away) === ticket.selectionCode
    ? { outcome: 'WON', entitlement: ticket.potentialReturn }
    : { outcome: 'LOST', entitlement: 0 };
}

/**
 * Credit-only correction policy: after a corrected result the player receives
 * the difference if the new entitlement is higher than everything credited so
 * far; a lower entitlement is never clawed back.
 */
export function correctionCredit(creditedSoFar: number, newEntitlement: number): number {
  return Math.max(0, newEntitlement - creditedSoFar);
}
