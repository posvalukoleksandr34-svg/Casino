/**
 * Ordering rule for rounds whose outcome is decided by time (Crash).
 *
 * Two server-side instants decide every player action on such a round:
 *   receivedAt  — when the application received the HTTP request (taken
 *                 before authentication, rate limiting or any lock);
 *   processedAt — the database clock (clock_timestamp()), read *after* the
 *                 player's wallet and the round row are locked.
 * The engine declares when the flight is decided by time (`end`: the crash,
 * the automatic target or the cap). Settlement by time is only allowed from
 * the settlement deadline `end + TIME_SETTLEMENT_GRACE_MS`, by any path.
 *
 * An action is applied iff receivedAt < end AND processedAt < deadline.
 * Every path that settles by time (expiry job, lazy settlement on read, a
 * late action) also reads the database clock under the same locks and does
 * nothing before the deadline. With one clock and one lock order, this makes
 * the outcome independent of which transaction wins the lock:
 *   * an action that holds the locks with processedAt < deadline cannot find
 *     the round already settled by time (that needs a reading ≥ deadline,
 *     taken earlier under the same locks, and the clock does not go back);
 *   * an action that finds the round settled by time therefore has
 *     processedAt ≥ deadline, and the rule rejects it anyway.
 */
export const TIME_SETTLEMENT_GRACE_MS = 1_000;

export type TimedActionDecision =
  /** Received before the end and processed in time: apply it (e.g. cash out). */
  | { kind: 'apply' }
  /** Received at or after the end, deadline not reached: reject, change nothing. */
  | { kind: 'reject_ended' }
  /** Deadline reached: settle by time; the action is not applied. */
  | { kind: 'settle_by_time'; resolution: 'received_after_end' | 'processing_deadline_passed' };

export function settlementDeadline(end: Date): Date {
  return new Date(end.getTime() + TIME_SETTLEMENT_GRACE_MS);
}

export function decideTimedAction(t: { receivedAt: Date; processedAt: Date; end: Date }): TimedActionDecision {
  const receivedInTime = t.receivedAt.getTime() < t.end.getTime();
  if (t.processedAt.getTime() >= settlementDeadline(t.end).getTime()) {
    return { kind: 'settle_by_time', resolution: receivedInTime ? 'processing_deadline_passed' : 'received_after_end' };
  }
  return receivedInTime ? { kind: 'apply' } : { kind: 'reject_ended' };
}

/** True when a time-based settlement may run at `now` (never before the deadline). */
export function settlementDue(end: Date, now: Date): boolean {
  return now.getTime() >= settlementDeadline(end).getTime();
}
