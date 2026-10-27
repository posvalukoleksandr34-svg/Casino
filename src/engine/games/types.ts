/**
 * The contract every game implements. Game modules are pure: they never touch
 * the database, the network, wall-clock time or Math.random. All randomness
 * comes from the provably-fair RandomSource passed to `start`, and all
 * timing is passed in explicitly through ActionContext.
 */
import type { z } from 'zod';
import type { RandomSource } from '../rng/provably-fair';

export const GAME_IDS = ['roulette', 'dice', 'crash', 'mines', 'blackjack', 'slots', 'limbo', 'keno', 'plinko', 'hilo'] as const;
export type GameId = (typeof GAME_IDS)[number];

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

/** Thrown when a bet or action violates the game rules. Mapped to HTTP 422. */
export class GameRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GameRuleError';
  }
}

/**
 * Risk/expectation profile of a round, in minor units. RTP here *includes*
 * the returned stake: RTP = E[gross payout] / stake, house edge = 1 - RTP.
 */
export interface RiskProfile {
  /** Total amount staked so far in the round. */
  stake: number;
  /** Largest gross payout the round can still produce (the house's maximum liability). */
  maxPayout: number;
  /** Theoretical expected gross payout (may be fractional). */
  expectedPayout: number;
  /** Theoretical variance of the gross payout, in minor units squared. */
  payoutVariance: number;
}

export interface AdditionalStake {
  /** e.g. "double", "split", "insurance" */
  kind: string;
  amount: number;
  /** Optional per-wager metadata persisted with the bet row. */
  selection?: Record<string, unknown>;
  /**
   * For wagers added during a round: an upper bound on how much this wager
   * can add to the round's gross payout, decided by the rules alone (never by
   * the hidden outcome). The risk engine accepts or rejects the extra wager
   * from this bound before the action's result is revealed.
   */
  maxAddedPayout?: number;
}

export interface StepResult<S> {
  state: S;
  status: 'OPEN' | 'SETTLED';
  /** Gross amount to credit to the player; only meaningful when status is SETTLED. */
  payout: number;
  /** Extra wagers this step requires (debited atomically before the step is committed). */
  additionalStakes: AdditionalStake[];
  /** Updated risk profile when the step changes stakes or liability. */
  risk: RiskProfile;
}

export interface ActionContext {
  /** Milliseconds elapsed since the round started, measured by the server clock. */
  elapsedMs: number;
}

export interface TheoreticalSummary {
  /** Representative RTP (fraction, includes returned stake). */
  rtp: number;
  houseEdge: number;
  /** "exact" = derived analytically; "estimate" = simulation with a confidence interval. */
  method: 'exact' | 'estimate';
  /** 95% confidence interval for estimates. */
  ci95?: [number, number];
  notes: string;
}

/**
 * Methods (not function-valued properties) are used deliberately so concrete
 * modules remain assignable to the type-erased registry entry.
 */
export interface GameModule<C = unknown, B = unknown, S = unknown, A = unknown, V = unknown> {
  readonly id: GameId;
  readonly name: string;
  readonly interactive: boolean;
  readonly configSchema: z.ZodType<C>;
  readonly defaultConfig: C;
  readonly betSchema: z.ZodType<B>;
  readonly actionSchema: z.ZodType<A> | null;
  /** Validates a bet against the configuration and returns its initial risk profile. */
  assess(config: C, bet: B): RiskProfile;
  /**
   * The individual wagers that make up the initial bet (one per roulette
   * position, a single MAIN wager for most games). Amounts sum to the stake.
   */
  wagers(config: C, bet: B): AdditionalStake[];
  /** Consumes randomness and produces the first state (final state for instant games). */
  start(config: C, bet: B, rng: RandomSource): StepResult<S>;
  /** Applies a player action to an open round (interactive games only). */
  act(config: C, state: S, action: A, ctx: ActionContext): StepResult<S>;
  /**
   * Settles a round whose outcome is determined by time (e.g. a crash round
   * that crashed while the player was disconnected). Returns null when the
   * round must stay open.
   */
  expire(config: C, state: S, ctx: ActionContext): StepResult<S> | null;
  /**
   * Explicit time-expiry capability: the elapsed time (ms since the round
   * started, server clock) from which `expire` is guaranteed to settle this
   * open state, or null when the state never settles without a player action.
   * The server schedules automatic settlement from this value only, so games
   * that never expire (e.g. Mines) never enter the expiry queue.
   */
  expiresAfterMs(config: C, state: S): number | null;
  /** Client-safe view; secrets (mine positions, hole card, crash point) only once settled. */
  view(config: C, state: S, settled: boolean): V;
  /** Theoretical return for documentation and analytics. */
  theoretical(config: C): TheoreticalSummary;
}

export function settled<S>(state: S, payout: number, risk: RiskProfile): StepResult<S> {
  return { state, status: 'SETTLED', payout, additionalStakes: [], risk };
}

export function notInteractive(id: string): never {
  throw new GameRuleError('NOT_INTERACTIVE', `${id} rounds settle immediately and accept no actions`);
}

/** Exact variance helper over a discrete distribution of gross payouts. */
export function discreteMoments(outcomes: ReadonlyArray<{ p: number; payout: number }>): {
  mean: number;
  variance: number;
} {
  let mean = 0;
  let second = 0;
  for (const o of outcomes) {
    mean += o.p * o.payout;
    second += o.p * o.payout * o.payout;
  }
  return { mean, variance: Math.max(0, second - mean * mean) };
}
