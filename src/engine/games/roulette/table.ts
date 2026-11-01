/**
 * The automatic roulette table: a shared, continuous schedule of spins that
 * runs whether or not anyone bets, plus the provably fair derivation of each
 * table spin's result. Isomorphic (server, browser, verifier).
 *
 * A *table spin* is not a wager. It moves no chips, creates no round and no
 * ledger entry. A player's wager remains an ordinary round with the player's
 * own seeds (unchanged); the table's spins are what the wheel shows for
 * players who did not bet.
 *
 * Schedule: slot k starts at TABLE_EPOCH + k·CYCLE. Betting is open for the
 * first BETTING ms; the spin and its result follow; the next slot begins.
 *
 * Fairness: each UTC day has a server seed whose SHA-256 commitment is
 * published before the day's spins close; the seed is revealed after the
 * day ends. The result of slot k is the first draw of the standard stream
 *   HmacRandomStream({ serverSeed: daySeed, clientSeed: TABLE_CLIENT_SEED, nonce: k }).nextInt(37)
 * — exactly how a player round draws its pocket (`roulette.start`).
 */
import { HmacRandomStream } from '../../rng/provably-fair';
import { POCKETS } from './rules';

export const TABLE_EPOCH_MS = Date.UTC(2026, 0, 1);
/** Betting window of every table slot. */
export const TABLE_BETTING_MS = 15_000;
/** Time for the spin after betting closes (request + wheel animation). */
export const TABLE_SPIN_MS = 7_000;
/** Time the result stays on show before the next slot opens. */
export const TABLE_RESULT_MS = 6_000;
export const TABLE_CYCLE_MS = TABLE_BETTING_MS + TABLE_SPIN_MS + TABLE_RESULT_MS;
export const TABLE_CLIENT_SEED = 'aurovane-table';

export interface TableSlot {
  slot: number;
  startsAt: number;
  closesAt: number;
  spinUntil: number;
  endsAt: number;
}

export function slotTimes(slot: number): TableSlot {
  const startsAt = TABLE_EPOCH_MS + slot * TABLE_CYCLE_MS;
  return {
    slot,
    startsAt,
    closesAt: startsAt + TABLE_BETTING_MS,
    spinUntil: startsAt + TABLE_BETTING_MS + TABLE_SPIN_MS,
    endsAt: startsAt + TABLE_CYCLE_MS,
  };
}

/** The slot running at time `now` (ms since the Unix epoch). */
export function slotAt(now: number): TableSlot {
  return slotTimes(Math.max(0, Math.floor((now - TABLE_EPOCH_MS) / TABLE_CYCLE_MS)));
}

/** The UTC day (YYYY-MM-DD) a slot belongs to: the day it closes in. */
export function slotDay(slot: number): string {
  return new Date(slotTimes(slot).closesAt).toISOString().slice(0, 10);
}

/** A table spin's pocket from its day seed — the same first draw a player round uses. */
export function tableSpinResult(daySeed: string, slot: number): number {
  return new HmacRandomStream({ serverSeed: daySeed, clientSeed: TABLE_CLIENT_SEED, nonce: slot }).nextInt(POCKETS);
}
