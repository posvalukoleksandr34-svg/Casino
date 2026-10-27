/**
 * Sports simulator configuration: limits (code constants, virtual chips) and
 * the provider mode from the server environment. Nothing here reaches the
 * browser except the derived, non-secret labels.
 */
import { env } from '../env';

const CHIP = 100;

export const SPORTS_LIMITS = {
  minStake: 10,
  maxStake: 1_000 * CHIP,
  /** Largest gross return of one ticket. */
  maxReturnPerTicket: 100_000 * CHIP,
  /** Largest open liability (potential return − stake, summed) on one event. */
  maxEventLiability: 5_000_000 * CHIP,
  maxSelectionsPerSlip: 10,
} as const;

export const DEMO_SCHEDULE = {
  /** A demo fixture kicks off every slot. */
  slotMinutes: 20,
  /** Fixtures are created this far ahead. */
  horizonHours: 24,
  /** The simulated full-time result is drawn this long after kick-off. */
  resultDelayMinutes: 10,
} as const;

/** Live fixtures postponed for longer than this are voided. */
export const POSTPONEMENT_VOID_HOURS = 48;

export type SportsMode = 'demo' | 'live' | 'off';

export interface SportsConfig {
  mode: SportsMode;
  /** True when live mode is selected but a provider key is missing (fails closed: no events are offered). */
  misconfigured: boolean;
  oddsMaxAgeMs: number;
  syncIntervalMs: number;
}

export function sportsConfig(): SportsConfig {
  const e = env();
  const misconfigured = e.SPORTS_MODE === 'live' && (!e.FOOTBALL_DATA_API_KEY || !e.THE_ODDS_API_KEY);
  return {
    mode: e.SPORTS_MODE,
    misconfigured,
    oddsMaxAgeMs: e.SPORTS_ODDS_MAX_AGE_MINUTES * 60_000,
    syncIntervalMs: e.SPORTS_SYNC_MINUTES * 60_000,
  };
}

/**
 * The prediction window of a market: open from `opensAt` (or creation) until
 * the earlier of `closesAt` and kick-off. Operators may set either bound
 * (migration 0008); the close is never later than kick-off.
 */
export function predictionWindow(market: { opensAt: Date | null; closesAt: Date | null }, kickoffAt: Date, now: Date) {
  const closesAt = market.closesAt && market.closesAt < kickoffAt ? market.closesAt : kickoffAt;
  const state: 'not_open' | 'open' | 'closed' = market.opensAt && market.opensAt > now ? 'not_open' : closesAt <= now ? 'closed' : 'open';
  return { opensAt: market.opensAt, closesAt, state };
}
