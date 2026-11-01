/**
 * SMS phone verification: unavailable without a provider (no challenge, no
 * claim of verification); with a test provider, codes are single-use, hashed,
 * limited in attempts and resends, bound to the number they were sent to, and
 * concurrency-safe; deletion erases the numbers; logs stay clean.
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { phoneVerificationChallenges, users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { deleteAccount } from '@/server/users/accounts';
import { updateAccountDetails } from '@/server/users/onboarding';
import { confirmPhoneVerification, ERASED_PHONE, phoneVerificationStatus, startPhoneVerification } from '@/server/users/phone-verification';
import { setSmsProviderForTests, type SmsProvider } from '@/server/verification/sms';
import { newPlayer, PLAYER_PASSWORD } from './helpers';

const meta = { ipHash: null, userAgent: 'vitest' };
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));
const reason = (e: unknown) => (e instanceof AppError ? e.details?.reason : undefined);

const texts: { to: string; text: string }[] = [];
let failNext: 'temporary' | 'permanent' | null = null;
const testProvider: SmsProvider = {
  name: 'test',
  async send(to, text) {
    if (failNext) {
      const kind = failNext;
      failNext = null;
      throw Object.assign(new Error('provider down'), { permanent: kind === 'permanent' });
    }
    texts.push({ to, text });
  },
};
const lastCode = (to: string) => /code is (\d{6})/.exec(texts.filter((t) => t.to === to).at(-1)?.text ?? '')?.[1] ?? '';
let seq = 0;
/** A player with their own number (Ofcom drama range 020 7946 0000–0999), so per-number limits do not collide. */
async function player(prefix: string) {
  const p = await newPlayer(prefix);
  seq += 1;
  const national = `020 7946 0${String(100 + ((Date.now() / 1000 + seq) % 900 | 0)).padStart(3, '0')}`;
  const d = await updateAccountDetails(p.userId, { phoneRegion: 'GB', phoneNumber: national }, meta);
  return { ...p, phone: d.phoneE164! };
}
const pastCooldown = (userId: string) => getDb().execute(sql`UPDATE phone_verification_challenges SET created_at = created_at - interval '61 seconds' WHERE user_id = ${userId}`);

afterEach(() => {
  setSmsProviderForTests(undefined);
  failNext = null;
  vi.restoreAllMocks();
});

describe('without an SMS provider', () => {
  it('refuses honestly and creates nothing', async () => {
    const p = await newPlayer('ph0');
    expect((await phoneVerificationStatus(p.userId)).available).toBe(false);
    const err = await startPhoneVerification(p.userId, meta).catch((e) => e);
    expect(code(err)).toBe('SERVICE_UNAVAILABLE');
    expect(await getDb().select().from(phoneVerificationChallenges).where(eq(phoneVerificationChallenges.userId, p.userId))).toHaveLength(0);
    const [u] = await getDb().select({ v: users.phoneVerifiedAt }).from(users).where(eq(users.id, p.userId));
    expect(u!.v).toBeNull();
  });
});

describe('with an SMS provider', () => {
  it('verifies the number with a single-use code stored only as an HMAC', async () => {
    setSmsProviderForTests(testProvider);
    const p = await player('ph1');
    const status = await startPhoneVerification(p.userId, meta);
    expect(status.pending?.sent).toBe(true);
    const c = lastCode(p.phone);
    const [row] = await getDb().select().from(phoneVerificationChallenges).where(eq(phoneVerificationChallenges.userId, p.userId));
    expect(row!.codeMac).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.codeMac).not.toContain(c);
    const wrong = c === '000000' ? '111111' : '000000';
    expect((await confirmPhoneVerification(p.userId, wrong, meta).catch((e) => e)).details?.attemptsLeft).toBe(4);
    const ok = await confirmPhoneVerification(p.userId, c, meta);
    expect(ok.verified).toBe(true);
    expect(code(await confirmPhoneVerification(p.userId, c, meta).catch((e) => e))).toBe('CONFLICT');
  });

  it('locks a code after five wrong attempts, expires codes, and limits resends', async () => {
    setSmsProviderForTests(testProvider);
    const p = await player('ph2');
    await startPhoneVerification(p.userId, meta);
    const c = lastCode(p.phone);
    const wrong = c === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) await confirmPhoneVerification(p.userId, wrong, meta).catch(() => undefined);
    expect(reason(await confirmPhoneVerification(p.userId, c, meta).catch((e) => e))).toBe('too_many_attempts');
    expect(code(await startPhoneVerification(p.userId, meta).catch((e) => e))).toBe('RATE_LIMITED');
    await pastCooldown(p.userId);
    await startPhoneVerification(p.userId, meta);
    await getDb().execute(sql`UPDATE phone_verification_challenges SET created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' WHERE user_id = ${p.userId} AND consumed_at IS NULL AND superseded_at IS NULL`);
    expect(reason(await confirmPhoneVerification(p.userId, lastCode(p.phone), meta).catch((e) => e))).toBe('expired');
  });

  it('a code verifies only the number it was sent to', async () => {
    setSmsProviderForTests(testProvider);
    const p = await player('ph3');
    await startPhoneVerification(p.userId, meta);
    const c = lastCode(p.phone);
    await updateAccountDetails(p.userId, { phoneRegion: 'FR', phoneNumber: '6 12 34 56 78' }, meta);
    expect(reason(await confirmPhoneVerification(p.userId, c, meta).catch((e) => e))).toBe('no_code');
    const [u] = await getDb().select({ v: users.phoneVerifiedAt }).from(users).where(eq(users.id, p.userId));
    expect(u!.v).toBeNull();
  });

  it('records failed and rejected deliveries; a failed one can be replaced at once', async () => {
    setSmsProviderForTests(testProvider);
    const p = await player('ph4');
    failNext = 'temporary';
    expect((await startPhoneVerification(p.userId, meta)).pending?.sent).toBe(false);
    failNext = 'permanent';
    await startPhoneVerification(p.userId, meta); // no cooldown after a failed delivery
    const rows = await getDb().select({ d: phoneVerificationChallenges.delivery }).from(phoneVerificationChallenges).where(eq(phoneVerificationChallenges.userId, p.userId));
    expect(rows.map((r) => r.d).sort()).toEqual(['FAILED', 'REJECTED']);
  });

  it('concurrent correct confirmations verify once', async () => {
    setSmsProviderForTests(testProvider);
    const p = await player('ph5');
    await startPhoneVerification(p.userId, meta);
    const c = lastCode(p.phone);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => confirmPhoneVerification(p.userId, c, meta)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const consumed = await getDb().select().from(phoneVerificationChallenges).where(and(eq(phoneVerificationChallenges.userId, p.userId), sql`consumed_at IS NOT NULL`));
    expect(consumed).toHaveLength(1);
  });

  it('deletion erases the numbers codes were sent to; logs carry neither number nor code', async () => {
    setSmsProviderForTests(testProvider);
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((x: unknown) => (lines.push(String(x)), true)) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((x: unknown) => (lines.push(String(x)), true)) as typeof process.stderr.write);
    const p = await player('ph6');
    failNext = 'temporary';
    await startPhoneVerification(p.userId, meta);
    vi.restoreAllMocks();
    expect(lines.join('')).toContain('sms delivery failed');
    expect(lines.join('')).not.toContain('7946');
    await deleteAccount(p.userId, PLAYER_PASSWORD, meta);
    const rows = await getDb().select({ phone: phoneVerificationChallenges.phoneE164 }).from(phoneVerificationChallenges).where(eq(phoneVerificationChallenges.userId, p.userId));
    expect(rows.every((r) => r.phone === ERASED_PHONE)).toBe(true);
  });
});
