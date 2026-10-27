/**
 * Hi-Lo (interactive, server-authoritative).
 *
 * Cards: every card is drawn independently and uniformly from a standard
 * 52-card deck (an "infinite deck": cards are replaced). Ranks run A = 1
 * (lowest) to K = 13 (highest); suits are cosmetic.
 *
 * Play: a first card is shown. The player guesses whether the next card is
 * strictly HIGHER or strictly LOWER than the current one; an equal rank
 * loses. With current rank r:
 *   P(higher) = (13 − r) / 13 (unavailable on a King),
 *   P(lower)  = (r − 1) / 13  (unavailable on an Ace).
 * A correct guess keeps the round alive; the player may then cash out, guess
 * again, or skip the current card (up to `maxSkips` per round; a skip never
 * changes the multiplier).
 *
 * Multiplier after k correct guesses with success numerators a₁…a_k:
 *   M_k = ⌊(10000 − edge) · 13^k / (a₁ · … · a_k)⌋ / 10⁴   (exact integers)
 * i.e. (1 − edge) / P(all k guesses correct), the house edge applied once.
 * Without the floor, M_k · 1{alive} is (1 − edge) times a martingale with
 * value 1 after any number of guesses or skips, so by optional stopping
 * every strategy (bounded: the cap and skip limit end every round) returns
 * exactly 1 − edge; the floor only lowers it (docs/math/hilo.md).
 *
 * Reaching `maxMultiplierE4` cashes out automatically at the cap. The whole
 * card sequence is drawn when the round starts (so it is fixed by the seeds,
 * whatever the player decides); the client only ever sees cards already turned
 * over, and anyone can recompute the sequence from the revealed seeds.
 */
import { z } from 'zod';
import { MAX_MULTIPLIER, mulDivFloor } from '../../money';
import type { RandomSource } from '../../rng/provably-fair';
import { stakeSchema } from '../shared';
import { GameRuleError, settled, type GameModule, type RiskProfile, type StepResult } from '../types';

export const HILO_RANKS = 13;
export const HILO_CARDS = 52;

export const rankOf = (card: number) => Math.floor(card / 4) + 1;
export const suitOf = (card: number) => card % 4;
const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_LABELS = ['♠', '♥', '♦', '♣'];
export const cardLabel = (card: number) => `${RANK_LABELS[rankOf(card) - 1]}${SUIT_LABELS[suitOf(card)]}`;

export const hiloConfigSchema = z.object({
  houseEdgeBp: z.int().min(1).max(2000),
  /** Multiplier cap ×10⁴ (10_000_000 = 1,000×); reaching it cashes out automatically. */
  maxMultiplierE4: z.int().min(20_000).max(MAX_MULTIPLIER * 10_000),
  /** Skips allowed per round. */
  maxSkips: z.int().min(0).max(100),
});
export type HiloConfig = z.infer<typeof hiloConfigSchema>;

export const hiloBetSchema = z.object({ amount: stakeSchema }).strict();
export type HiloBet = z.infer<typeof hiloBetSchema>;

export const hiloActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guess'), direction: z.enum(['higher', 'lower']) }).strict(),
  z.object({ type: z.literal('skip') }).strict(),
  z.object({ type: z.literal('cashout') }).strict(),
]);
export type HiloAction = z.infer<typeof hiloActionSchema>;

export interface HiloStep {
  card: number;
  /** How this card came up: the first card, a guess, or a skip. */
  via: 'start' | 'higher' | 'lower' | 'skip';
  /** Whether the guess that revealed it was right (null for start and skips). */
  correct: boolean | null;
}

export interface HiloState {
  amount: number;
  /** Secret while the round is open: every card the round can use, in order. */
  sequence: number[];
  /** Index in `sequence` of the current card. */
  position: number;
  steps: HiloStep[];
  /** Success numerators a_i of the correct guesses (P = a_i / 13). */
  factors: number[];
  skips: number;
  multiplierE4: number;
  status: 'playing' | 'busted' | 'cashed';
  payout: number;
}

export interface HiloOption {
  available: boolean;
  /** Probability that this guess is right. */
  probability: number;
  /** Multiplier after a correct guess (capped). */
  multiplierE4: number;
}

/** Client view: the pre-drawn sequence is never sent; only cards already turned over (in `steps`). */
export interface HiloView extends Omit<HiloState, 'sequence'> {
  currentCard: number;
  higher: HiloOption | null;
  lower: HiloOption | null;
  skipsLeft: number;
  canCashOut: boolean;
}

/** Correct guesses that can be made before the cap must be reached (each multiplies by ≥ 13/12). */
export function maxGuesses(config: HiloConfig): number {
  const capRatio = config.maxMultiplierE4 / (10_000 - config.houseEdgeBp);
  return Math.ceil(Math.log(capRatio) / Math.log(13 / 12)) + 1;
}

/** Cards drawn when a round starts: the first card, every possible guess and every skip. */
export function sequenceLength(config: HiloConfig): number {
  return 1 + maxGuesses(config) + config.maxSkips;
}

/** Exact uncapped multiplier ×10⁴ for the given success numerators. */
export function hiloMultiplierE4(houseEdgeBp: number, factors: readonly number[]): number {
  if (factors.length === 0) return 10_000;
  let num = BigInt(10_000 - houseEdgeBp);
  let den = 1n;
  for (const a of factors) {
    if (!Number.isInteger(a) || a < 1 || a > 12) throw new RangeError(`invalid success numerator ${a}`);
    num *= BigInt(HILO_RANKS);
    den *= BigInt(a);
  }
  const m = num / den;
  return m > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(m);
}

/** Success numerator for a guess from rank r (0 when the guess is impossible). */
export function successNumerator(rank: number, direction: 'higher' | 'lower'): number {
  return direction === 'higher' ? HILO_RANKS - rank : rank - 1;
}

/** Side with the larger success chance from rank r (higher on a 7, where both are 6/13). */
export function likelierSide(rank: number): 'higher' | 'lower' {
  return successNumerator(rank, 'higher') >= successNumerator(rank, 'lower') ? 'higher' : 'lower';
}

/**
 * Exact RTP of the strategy "always guess the likelier side, cash out after k
 * correct guesses (or at the cap)". Dynamic programming over (current rank,
 * product of success numerators): the multiplier depends only on that product
 * and the number of guesses, so paths are merged instead of enumerated.
 */
export function hiloStrategyRtp(config: HiloConfig, k: number): number {
  const edge = BigInt(10_000 - config.houseEdgeBp);
  let states = new Map<string, { rank: number; den: bigint; p: number }>();
  for (let r = 1; r <= HILO_RANKS; r += 1) states.set(`${r}|1`, { rank: r, den: 1n, p: 1 / HILO_RANKS });
  let rtp = 0;
  let num = edge;
  for (let step = 1; step <= k && states.size > 0; step += 1) {
    num *= BigInt(HILO_RANKS);
    const next = new Map<string, { rank: number; den: bigint; p: number }>();
    for (const s of states.values()) {
      const side = likelierSide(s.rank);
      const a = successNumerator(s.rank, side);
      const den = s.den * BigInt(a);
      const m = Number(num / den);
      for (let r = 1; r <= HILO_RANKS; r += 1) {
        if (side === 'higher' ? r <= s.rank : r >= s.rank) continue;
        const p = s.p / HILO_RANKS;
        if (m >= config.maxMultiplierE4 || step === k) {
          rtp += p * (capped(config, m) / 10_000);
          continue;
        }
        const key = `${r}|${den}`;
        const prev = next.get(key);
        if (prev) prev.p += p;
        else next.set(key, { rank: r, den, p });
      }
    }
    states = next;
  }
  return rtp;
}

function capped(config: HiloConfig, m: number): number {
  return Math.min(m, config.maxMultiplierE4);
}

/**
 * Risk for the decisions on `path` (success numerators of every guess made or
 * about to be made). Strategy-dependent game: like Mines, the expectation is
 * reported for "make exactly these guesses, then cash out", whose return is
 * (1 − edge) up to the 4-decimal floor for any path (documented approximation).
 */
function riskFor(config: HiloConfig, amount: number, path: readonly number[], settledPayout?: number): RiskProfile {
  const maxPayout = settledPayout ?? mulDivFloor(amount, config.maxMultiplierE4, 10_000);
  if (path.length === 0) return { stake: amount, maxPayout, expectedPayout: 0, payoutVariance: 0 };
  const p = path.reduce((acc, a) => acc * (a / HILO_RANKS), 1);
  const win = mulDivFloor(amount, capped(config, hiloMultiplierE4(config.houseEdgeBp, path)), 10_000);
  return { stake: amount, maxPayout, expectedPayout: win * p, payoutVariance: win * win * p * (1 - p) };
}

/** Open-round risk: the next guess on the likelier side, then cash out. */
function openRisk(config: HiloConfig, state: HiloState): RiskProfile {
  const r = rankOf(state.sequence[state.position]!);
  const a = Math.max(successNumerator(r, 'higher'), successNumerator(r, 'lower'));
  return riskFor(config, state.amount, [...state.factors, a]);
}

function finish(config: HiloConfig, state: HiloState, path: readonly number[]): StepResult<HiloState> {
  return settled(state, state.payout, riskFor(config, state.amount, path, state.payout));
}

function nextCard(state: HiloState): { card: number; position: number } {
  const position = state.position + 1;
  const card = state.sequence[position];
  if (card === undefined) throw new Error('hi-lo card sequence exhausted (bounds violated)');
  return { card, position };
}

export const hilo: GameModule<HiloConfig, HiloBet, HiloState, HiloAction, HiloView> = {
  id: 'hilo',
  name: 'Hi-Lo',
  interactive: true,
  configSchema: hiloConfigSchema,
  defaultConfig: { houseEdgeBp: 100, maxMultiplierE4: 10_000_000, maxSkips: 52 },
  betSchema: hiloBetSchema,
  actionSchema: hiloActionSchema,

  assess(config, bet) {
    // Before the first card is known: the worst case is the cap; the expectation uses the likeliest first guess.
    return riskFor(config, bet.amount, [12]);
  },

  wagers(_config, bet) {
    return [{ kind: 'MAIN', amount: bet.amount }];
  },

  start(config, bet, rng: RandomSource) {
    const sequence = Array.from({ length: sequenceLength(config) }, () => rng.nextInt(HILO_CARDS));
    const state: HiloState = {
      amount: bet.amount,
      sequence,
      position: 0,
      steps: [{ card: sequence[0]!, via: 'start', correct: null }],
      factors: [],
      skips: 0,
      multiplierE4: 10_000,
      status: 'playing',
      payout: 0,
    };
    return { state, status: 'OPEN', payout: 0, additionalStakes: [], risk: openRisk(config, state) };
  },

  act(config, state, action) {
    if (state.status !== 'playing') throw new GameRuleError('ROUND_FINISHED', 'This round has finished');
    if (action.type === 'cashout') {
      if (state.factors.length === 0) throw new GameRuleError('NOTHING_TO_CASH_OUT', 'Make at least one correct guess before cashing out');
      return finish(config, { ...state, status: 'cashed', payout: mulDivFloor(state.amount, state.multiplierE4, 10_000) }, state.factors);
    }
    if (action.type === 'skip') {
      if (state.skips >= config.maxSkips) throw new GameRuleError('SKIP_LIMIT', `You can skip at most ${config.maxSkips} cards per round`);
      const { card, position } = nextCard(state);
      const next: HiloState = { ...state, position, skips: state.skips + 1, steps: [...state.steps, { card, via: 'skip', correct: null }] };
      return { state: next, status: 'OPEN', payout: 0, additionalStakes: [], risk: openRisk(config, next) };
    }
    const rank = rankOf(state.sequence[state.position]!);
    const a = successNumerator(rank, action.direction);
    if (a === 0) {
      throw new GameRuleError('GUESS_IMPOSSIBLE', action.direction === 'higher' ? 'No card is higher than a King' : 'No card is lower than an Ace');
    }
    const { card, position } = nextCard(state);
    const nextRank = rankOf(card);
    const correct = action.direction === 'higher' ? nextRank > rank : nextRank < rank;
    const steps = [...state.steps, { card, via: action.direction, correct }];
    if (!correct) return finish(config, { ...state, position, steps, status: 'busted', payout: 0 }, [...state.factors, a]);
    const factors = [...state.factors, a];
    const m = hiloMultiplierE4(config.houseEdgeBp, factors);
    const next: HiloState = { ...state, position, steps, factors, multiplierE4: capped(config, m) };
    if (m >= config.maxMultiplierE4) {
      return finish(config, { ...next, status: 'cashed', payout: mulDivFloor(state.amount, config.maxMultiplierE4, 10_000) }, factors);
    }
    return { state: next, status: 'OPEN', payout: 0, additionalStakes: [], risk: openRisk(config, next) };
  },

  expire() {
    return null; // Hi-Lo rounds never expire; the player can always return and continue.
  },

  expiresAfterMs() {
    return null;
  },

  view(config, state, isFinal) {
    const playing = !isFinal && state.status === 'playing';
    const current = state.sequence[state.position]!;
    const rank = rankOf(current);
    const option = (direction: 'higher' | 'lower'): HiloOption => {
      const a = successNumerator(rank, direction);
      return {
        available: a > 0,
        probability: a / HILO_RANKS,
        multiplierE4: a > 0 ? capped(config, hiloMultiplierE4(config.houseEdgeBp, [...state.factors, a])) : 0,
      };
    };
    return {
      amount: state.amount,
      position: state.position,
      steps: state.steps,
      factors: state.factors,
      skips: state.skips,
      multiplierE4: state.multiplierE4,
      status: state.status,
      payout: state.payout,
      currentCard: current,
      higher: playing ? option('higher') : null,
      lower: playing ? option('lower') : null,
      skipsLeft: Math.max(0, config.maxSkips - state.skips),
      canCashOut: playing && state.factors.length > 0,
    };
  },

  theoretical(config) {
    const edge = config.houseEdgeBp / 10_000;
    return {
      rtp: 1 - edge,
      houseEdge: edge,
      method: 'exact',
      notes: `Every strategy (any guesses, skips and cash-out point) returns at most ${((1 - edge) * 100).toFixed(2)}%: the multiplier is (1 − edge) / P(all guesses right), rounded down to 4 decimals.`,
    };
  },
};
