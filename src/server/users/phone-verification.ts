/**
 * Phone-number verification by SMS code, active only when an SMS provider is
 * configured (src/server/verification/sms.ts). Same design as the e-mail
 * codes: CSPRNG six-digit codes stored as HMACs keyed with a server secret and
 * bound to the challenge id, 10-minute expiry, 5 wrong attempts per code, one
 * live challenge per account, a 60-second resend cooldown and 5 codes per
 * hour, plus per-IP and keyed per-number rate limits. A code verifies only the
 * number it was sent to: if the account's number changed in between, the
 * challenge is void. Verification is the only way phone_verified_at is set.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { CODES_PER_HOUR, RESEND_COOLDOWN_SECONDS, VERIFICATION_MAX_ATTEMPTS, VERIFICATION_TTL_MINUTES } from '@/lib/account-policy';
import { audit } from '../audit/audit';
import { getDb, withTransaction, type Tx } from '../db/client';
import { phoneVerificationChallenges, users } from '../db/schema';
import { AppError, errors } from '../errors';
import { consume, type RateLimitRule } from '../http/rate-limit';
import { logger } from '../observability/logger';
import { metrics } from '../observability/metrics';
import { getSmsProvider } from '../verification/sms';
import { derivedKey, newVerificationCode, validCodeFormat, type VerificationMeta } from './verification';

/** Written over the stored numbers of a deleted account (+999 is not an assigned country code). */
export const ERASED_PHONE = '+999000000000';

export const PHONE_LIMITS = {
  sendIp: { name: 'phone-send:ip', limit: 10, windowSeconds: 3600, by: 'ip' },
  sendNumber: { name: 'phone-send:number', limit: CODES_PER_HOUR, windowSeconds: 3600, by: 'user' },
  verifyIp: { name: 'phone-verify:ip', limit: 30, windowSeconds: 600, by: 'ip' },
} as const satisfies Record<string, RateLimitRule>;

function mac(id: string, code: string): string {
  return createHmac('sha256', derivedKey('aurovane:phone-code:v1')).update(`${id}:${code}`).digest('hex');
}

function numberKey(e164: string): string {
  return createHmac('sha256', derivedKey('aurovane:phone-bucket:v1')).update(e164).digest('hex').slice(0, 32);
}

export function phoneVerificationAvailable(): boolean {
  return getSmsProvider() !== null;
}

export interface PhoneVerificationStatus {
  available: boolean;
  phone: string | null;
  verified: boolean;
  pending: { expiresAt: string; attemptsLeft: number; sent: boolean | null; resendAvailableAt: string } | null;
}

async function live(tx: Tx, userId: string, lock: boolean) {
  const q = tx
    .select()
    .from(phoneVerificationChallenges)
    .where(and(eq(phoneVerificationChallenges.userId, userId), isNull(phoneVerificationChallenges.consumedAt), isNull(phoneVerificationChallenges.supersededAt)));
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

async function cooldown(tx: Tx, userId: string, now: Date): Promise<number> {
  const recent = await tx
    .select({ createdAt: phoneVerificationChallenges.createdAt, delivery: phoneVerificationChallenges.delivery })
    .from(phoneVerificationChallenges)
    .where(and(eq(phoneVerificationChallenges.userId, userId), gt(phoneVerificationChallenges.createdAt, new Date(now.getTime() - 3600_000))))
    .orderBy(desc(phoneVerificationChallenges.createdAt));
  const counted = recent.filter((r) => r.delivery !== 'FAILED' && r.delivery !== 'REJECTED');
  const latest = counted[0];
  if (latest) {
    const wait = Math.ceil((latest.createdAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000);
    if (wait > 0) return wait;
  }
  if (counted.length >= CODES_PER_HOUR) return Math.max(1, Math.ceil((counted[counted.length - 1]!.createdAt.getTime() + 3600_000 - now.getTime()) / 1000));
  return 0;
}

export async function phoneVerificationStatus(userId: string, now = new Date()): Promise<PhoneVerificationStatus> {
  return withTransaction(async (tx) => {
    const [u] = await tx.select({ phone: users.phoneE164, verifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, userId));
    const c = await live(tx, userId, false);
    const usable = c && u?.phone === c.phoneE164 ? c : null;
    return {
      available: phoneVerificationAvailable(),
      phone: u?.phone ?? null,
      verified: Boolean(u?.verifiedAt),
      pending: usable
        ? {
            expiresAt: usable.expiresAt.toISOString(),
            attemptsLeft: Math.max(0, usable.maxAttempts - usable.attempts),
            sent: usable.delivery === 'PENDING' ? null : usable.delivery === 'SENT',
            resendAvailableAt: new Date(now.getTime() + (await cooldown(tx, userId, now)) * 1000).toISOString(),
          }
        : null,
    };
  });
}

/** Sends a code to the account's current number. */
export async function startPhoneVerification(userId: string, meta: VerificationMeta): Promise<PhoneVerificationStatus> {
  const provider = getSmsProvider();
  if (!provider) throw new AppError('SERVICE_UNAVAILABLE', 'Phone verification is not available on this site yet. Your number is stored as unverified.', { reason: 'sms_unavailable' });
  const [pre] = await getDb().select({ phone: users.phoneE164 }).from(users).where(eq(users.id, userId));
  if (pre?.phone) await consume(PHONE_LIMITS.sendNumber, numberKey(pre.phone));
  const now = new Date();
  const issued = await withTransaction(async (tx) => {
    const [u] = await tx.select({ phone: users.phoneE164, verifiedAt: users.phoneVerifiedAt, status: users.status }).from(users).where(eq(users.id, userId)).for('update');
    if (!u || u.status !== 'ACTIVE') throw errors.forbidden();
    if (!u.phone) throw errors.validation('Add a phone number first');
    if (u.verifiedAt) throw errors.conflict('This phone number is already verified');
    const wait = await cooldown(tx, userId, now);
    if (wait > 0) throw new AppError('RATE_LIMITED', `Please wait ${wait} seconds before requesting another code.`, { retryAfterSeconds: wait });
    await tx
      .update(phoneVerificationChallenges)
      .set({ supersededAt: now })
      .where(and(eq(phoneVerificationChallenges.userId, userId), isNull(phoneVerificationChallenges.consumedAt), isNull(phoneVerificationChallenges.supersededAt)));
    const id = randomUUID();
    const code = newVerificationCode();
    await tx.insert(phoneVerificationChallenges).values({
      id,
      userId,
      phoneE164: u.phone,
      codeMac: mac(id, code),
      maxAttempts: VERIFICATION_MAX_ATTEMPTS,
      provider: provider.name,
      createdAt: now,
      expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MINUTES * 60_000),
    });
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.phone_code_sent', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { provider: provider.name } });
    return { id, code, phone: u.phone };
  });
  let delivery: 'SENT' | 'FAILED' | 'REJECTED' = 'SENT';
  try {
    await provider.send(issued.phone, `Your Aurovane verification code is ${issued.code}. It expires in ${VERIFICATION_TTL_MINUTES} minutes. Never share it.`);
    metrics.inc('casino_sms_sent_total', { provider: provider.name });
  } catch (err) {
    delivery = (err as { permanent?: boolean }).permanent ? 'REJECTED' : 'FAILED';
    metrics.inc('casino_sms_failed_total', { provider: provider.name, kind: delivery === 'REJECTED' ? 'permanent' : 'temporary' });
    logger.error('sms delivery failed', { userId, provider: provider.name, kind: delivery });
  }
  await getDb().update(phoneVerificationChallenges).set({ delivery }).where(eq(phoneVerificationChallenges.id, issued.id));
  return phoneVerificationStatus(userId);
}

/** Checks the code (counting the attempt) and marks the number verified once. */
export async function confirmPhoneVerification(userId: string, code: string, meta: VerificationMeta): Promise<PhoneVerificationStatus> {
  if (!validCodeFormat(code)) throw errors.validation('Enter the 6-digit code from the text message', { reason: 'format' });
  const now = new Date();
  const outcome = await withTransaction(async (tx) => {
    const [u] = await tx.select({ phone: users.phoneE164, verifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, userId)).for('update');
    if (u?.verifiedAt) return { kind: 'already' as const };
    const c = await live(tx, userId, true);
    if (!c || c.phoneE164 !== u?.phone) return { kind: 'none' as const };
    if (c.expiresAt <= now) return { kind: 'expired' as const };
    if (c.attempts >= c.maxAttempts) return { kind: 'exhausted' as const };
    const match = timingSafeEqual(Buffer.from(c.codeMac, 'hex'), Buffer.from(mac(c.id, code), 'hex'));
    await tx
      .update(phoneVerificationChallenges)
      .set({ attempts: sql`${phoneVerificationChallenges.attempts} + 1`, ...(match ? { consumedAt: now } : {}) })
      .where(eq(phoneVerificationChallenges.id, c.id));
    if (!match) {
      await audit(tx, { actorId: userId, actorType: 'USER', action: 'auth.phone_verification_failed', resourceType: 'user', resourceId: userId, outcome: 'FAILED', ipHash: meta.ipHash });
      return { kind: 'wrong' as const, left: Math.max(0, c.maxAttempts - c.attempts - 1) };
    }
    await tx.update(users).set({ phoneVerifiedAt: now, updatedAt: now }).where(eq(users.id, userId));
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'user.phone_verified', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { provider: c.provider } });
    return { kind: 'ok' as const };
  });
  switch (outcome.kind) {
    case 'ok':
      return phoneVerificationStatus(userId);
    case 'already':
      throw errors.conflict('This phone number is already verified');
    case 'wrong':
      throw errors.validation(outcome.left > 0 ? `That code is not correct. ${outcome.left} attempt${outcome.left === 1 ? '' : 's'} left.` : 'That code is not correct, and it can no longer be used. Request a new code.', {
        reason: outcome.left > 0 ? 'incorrect' : 'too_many_attempts',
        attemptsLeft: outcome.left,
      });
    case 'expired':
      throw errors.validation('This code has expired. Request a new code.', { reason: 'expired' });
    case 'exhausted':
      throw errors.validation('Too many incorrect attempts for this code. Request a new code.', { reason: 'too_many_attempts', attemptsLeft: 0 });
    case 'none':
      throw errors.validation('There is no active code for your current number. Request a new code.', { reason: 'no_code' });
  }
}
