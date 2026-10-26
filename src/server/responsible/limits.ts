/**
 * Responsible-play controls, enforced server-side at wager acceptance.
 *
 *   * Loss and wager limits use rolling windows (24 h / 7 days).
 *   * Lowering a limit (or adding one) applies immediately; raising or
 *     removing a limit only takes effect after a 24-hour cooling-off period.
 *   * Cool-off and self-exclusion block all wagering until they expire and
 *     cannot be shortened by the player.
 *   * A session limit blocks wagering once the current login session has
 *     lasted longer than the chosen number of minutes.
 */
import { eq, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client';
import { responsibleLimits } from '../db/schema';
import { errors } from '../errors';

export const LIMIT_KEYS = ['dailyLossLimit', 'weeklyLossLimit', 'dailyWagerLimit', 'sessionLimitMinutes', 'realityCheckMinutes'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type LimitValues = Record<LimitKey, number | null>;

export const INCREASE_DELAY_MS = 24 * 60 * 60 * 1000;

type LimitsRow = typeof responsibleLimits.$inferSelect;

export async function ensureLimitsRow(db: Executor, userId: string): Promise<void> {
  await db.insert(responsibleLimits).values({ userId }).onConflictDoNothing();
}

function currentValues(row: LimitsRow): LimitValues {
  return {
    dailyLossLimit: row.dailyLossLimit,
    weeklyLossLimit: row.weeklyLossLimit,
    dailyWagerLimit: row.dailyWagerLimit,
    sessionLimitMinutes: row.sessionLimitMinutes,
    realityCheckMinutes: row.realityCheckMinutes,
  };
}

/** Applies matured pending increases. Returns the effective row. */
async function loadEffective(db: Executor, userId: string, now: Date): Promise<LimitsRow> {
  const [row] = await db.select().from(responsibleLimits).where(eq(responsibleLimits.userId, userId));
  if (!row) {
    await ensureLimitsRow(db, userId);
    return loadEffective(db, userId, now);
  }
  if (row.pending && row.pendingEffectiveAt && row.pendingEffectiveAt <= now) {
    const merged = { ...currentValues(row), ...(row.pending as Partial<LimitValues>) };
    const [updated] = await db
      .update(responsibleLimits)
      .set({ ...merged, pending: null, pendingEffectiveAt: null, updatedAt: now })
      .where(eq(responsibleLimits.userId, userId))
      .returning();
    return updated!;
  }
  return row;
}

/** True when `next` is stricter than or equal to `current` (null = no limit). */
function isTightening(current: number | null, next: number | null): boolean {
  if (next === null) return current === null;
  if (current === null) return true;
  return next <= current;
}

export async function getLimits(db: Executor, userId: string, now = new Date()) {
  const row = await loadEffective(db, userId, now);
  return {
    limits: currentValues(row),
    pending: (row.pending as Partial<LimitValues> | null) ?? null,
    pendingEffectiveAt: row.pendingEffectiveAt,
    coolOffUntil: row.coolOffUntil && row.coolOffUntil > now ? row.coolOffUntil : null,
    selfExcludedUntil: row.selfExcludedUntil && row.selfExcludedUntil > now ? row.selfExcludedUntil : null,
  };
}

export async function updateLimits(tx: Tx, userId: string, requested: Partial<LimitValues>, now = new Date()) {
  const row = await loadEffective(tx, userId, now);
  const current = currentValues(row);
  const immediate: Partial<LimitValues> = {};
  const delayed: Partial<LimitValues> = { ...((row.pending as Partial<LimitValues> | null) ?? {}) };
  for (const key of LIMIT_KEYS) {
    if (!(key in requested)) continue;
    const next = requested[key] ?? null;
    // Reality-check reminders are informational, so changes apply immediately.
    if (key === 'realityCheckMinutes' || isTightening(current[key], next)) {
      immediate[key] = next;
      delete delayed[key];
    } else {
      delayed[key] = next;
    }
  }
  const hasDelayed = Object.keys(delayed).length > 0;
  await tx
    .update(responsibleLimits)
    .set({
      ...immediate,
      pending: hasDelayed ? delayed : null,
      pendingEffectiveAt: hasDelayed ? (row.pendingEffectiveAt ?? new Date(now.getTime() + INCREASE_DELAY_MS)) : null,
      updatedAt: now,
    })
    .where(eq(responsibleLimits.userId, userId));
  return { applied: immediate, pending: hasDelayed ? delayed : null };
}

export async function startCoolOff(tx: Tx, userId: string, hours: number, now = new Date()) {
  const row = await loadEffective(tx, userId, now);
  const until = new Date(now.getTime() + hours * 3600_000);
  const effective = row.coolOffUntil && row.coolOffUntil > until ? row.coolOffUntil : until;
  await tx.update(responsibleLimits).set({ coolOffUntil: effective, updatedAt: now }).where(eq(responsibleLimits.userId, userId));
  return effective;
}

/** Self-exclusion; `months = null` means indefinite (stored as year 9999). */
export async function selfExclude(tx: Tx, userId: string, months: number | null, now = new Date()) {
  const row = await loadEffective(tx, userId, now);
  const until = months === null ? new Date('9999-12-31T00:00:00Z') : new Date(now.getTime() + months * 30 * 86400_000);
  const effective = row.selfExcludedUntil && row.selfExcludedUntil > until ? row.selfExcludedUntil : until;
  await tx
    .update(responsibleLimits)
    .set({ selfExcludedUntil: effective, updatedAt: now })
    .where(eq(responsibleLimits.userId, userId));
  return effective;
}

export interface PlayWindowTotals {
  wagered24h: number;
  netLoss24h: number;
  netLoss7d: number;
}

/**
 * Net loss counts every stake placed in the window as lost and subtracts
 * payouts received in the window, so open rounds are treated conservatively.
 */
export async function playTotals(db: Executor, userId: string, now: Date): Promise<PlayWindowTotals> {
  const day = new Date(now.getTime() - 86400_000);
  const week = new Date(now.getTime() - 7 * 86400_000);
  const res = await db.execute<{ w24: string; p24: string; w7: string; p7: string }>(sql`
    SELECT
      (SELECT coalesce(sum(stake), 0) FROM bets WHERE user_id = ${userId} AND created_at > ${day})::text AS w24,
      (SELECT coalesce(sum(amount), 0) FROM payouts WHERE user_id = ${userId} AND created_at > ${day})::text AS p24,
      (SELECT coalesce(sum(stake), 0) FROM bets WHERE user_id = ${userId} AND created_at > ${week})::text AS w7,
      (SELECT coalesce(sum(amount), 0) FROM payouts WHERE user_id = ${userId} AND created_at > ${week})::text AS p7
  `);
  const r = res.rows[0]!;
  return {
    wagered24h: Number(r.w24),
    netLoss24h: Number(r.w24) - Number(r.p24),
    netLoss7d: Number(r.w7) - Number(r.p7),
  };
}

/**
 * Throws RESPONSIBLE_GAMING when the wager is not allowed. Call while holding
 * the player's wallet lock so concurrent wagers cannot both pass the check.
 */
export async function assertCanWager(
  tx: Tx,
  userId: string,
  stake: number,
  opts: { sessionStartedAt?: Date | null; now?: Date },
): Promise<void> {
  const now = opts.now ?? new Date();
  const row = await loadEffective(tx, userId, now);
  if (row.selfExcludedUntil && row.selfExcludedUntil > now) {
    throw errors.responsible('Your account is self-excluded from play.', { until: row.selfExcludedUntil.toISOString() });
  }
  if (row.coolOffUntil && row.coolOffUntil > now) {
    throw errors.responsible('You are on a cool-off break.', { until: row.coolOffUntil.toISOString() });
  }
  if (row.sessionLimitMinutes && opts.sessionStartedAt) {
    const minutes = (now.getTime() - opts.sessionStartedAt.getTime()) / 60_000;
    if (minutes >= row.sessionLimitMinutes) {
      throw errors.responsible('Your session time limit has been reached. Please take a break and sign in again later.', {
        sessionLimitMinutes: row.sessionLimitMinutes,
      });
    }
  }
  if (!row.dailyLossLimit && !row.weeklyLossLimit && !row.dailyWagerLimit) return;
  const totals = await playTotals(tx, userId, now);
  if (row.dailyWagerLimit && totals.wagered24h + stake > row.dailyWagerLimit) {
    throw errors.responsible('This wager would exceed your 24-hour wagering limit.', {
      limit: row.dailyWagerLimit,
      used: totals.wagered24h,
    });
  }
  if (row.dailyLossLimit && totals.netLoss24h + stake > row.dailyLossLimit) {
    throw errors.responsible('This wager could exceed your 24-hour loss limit.', {
      limit: row.dailyLossLimit,
      used: Math.max(0, totals.netLoss24h),
    });
  }
  if (row.weeklyLossLimit && totals.netLoss7d + stake > row.weeklyLossLimit) {
    throw errors.responsible('This wager could exceed your 7-day loss limit.', {
      limit: row.weeklyLossLimit,
      used: Math.max(0, totals.netLoss7d),
    });
  }
}
