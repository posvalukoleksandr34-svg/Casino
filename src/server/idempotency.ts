/**
 * Request-level idempotency for state-changing player requests.
 *
 * The key row is inserted in the *same* database transaction as the business
 * operation and stores the response. Consequences:
 *   * a retried request with the same key returns the original response and
 *     never repeats the charge or payout;
 *   * concurrent duplicates block on the primary-key insert until the first
 *     commits, then replay its response;
 *   * if the first attempt rolls back, the key is released and a retry runs.
 * Reusing a key with a different payload is rejected (409).
 */
import { and, eq } from 'drizzle-orm';
import { canonicalJson, sha256Hex } from './crypto';
import type { Tx } from './db/client';
import { idempotencyKeys } from './db/schema';
import { AppError } from './errors';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

export function requestFingerprint(scope: string, payload: unknown): string {
  return sha256Hex(`${scope}\n${canonicalJson(payload)}`);
}

export async function runIdempotent<T>(
  tx: Tx,
  userId: string,
  key: string,
  fingerprint: string,
  fn: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header must be 8–100 characters of [A-Za-z0-9_-]');
  }
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ userId, key, requestHash: fingerprint })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted.length === 0) {
    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    if (!existing) throw new AppError('CONFLICT', 'Request is still being processed; retry shortly');
    if (existing.requestHash !== fingerprint) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request');
    }
    if (existing.responseStatus === null) {
      throw new AppError('CONFLICT', 'Request is still being processed; retry shortly');
    }
    return { status: existing.responseStatus, body: existing.responseBody as T, replayed: true };
  }
  const result = await fn();
  await tx
    .update(idempotencyKeys)
    .set({ responseStatus: result.status, responseBody: result.body as unknown })
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
  return { ...result, replayed: false };
}
