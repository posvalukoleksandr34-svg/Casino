/**
 * Registration → e-mail verification → onboarding: the account lifecycle,
 * code security (attempts, expiry, single use, resend limits, concurrency),
 * delivery modes, server-side onboarding gates on every API route, legacy
 * accounts, export/deletion of the new fields, and the absence of codes and
 * personal data in audit records and logs.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as registerRoute } from '@/app/api/auth/register/route';
import { GET as verifyStatusRoute, POST as verifyRoute } from '@/app/api/auth/verify-email/route';
import { SESSION_COOKIE_DEV, resolveSession } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { auditLogs, bonuses, emailVerificationChallenges, ledgerAccounts, seedPairs, sessions, users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { setMailerForTests, type Mailer } from '@/server/mail/mailer';
import { createOperatorAccount, deleteAccount, exportUserData, login, register, VerificationRequiredError } from '@/server/users/accounts';
import { accountDetails, completeOnboarding, normalisePhone, updateAccountDetails } from '@/server/users/onboarding';
import {
  changeSignupEmail,
  confirmEmailChange,
  FLOW_COOKIE_DEV,
  issueFlowToken,
  readFlowToken,
  requestEmailChange,
  resendSignupCode,
  signupStatus,
  verifySignupCode,
} from '@/server/users/verification';
import { expectLedgerConsistent, newPlayer, ONBOARDING_SAMPLE, PLAYER_PASSWORD } from './helpers';
import { failNextDeliveries, latestCode, messagesTo, sentMail, withMailbox } from '../support/mailbox';

const meta = { ipHash: null, userAgent: 'vitest' };
const BASE = 'http://localhost:3000';
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));
const reason = (e: unknown) => (e instanceof AppError ? (e.details?.reason as string | undefined) : undefined);
let n = 0;

function input(overrides: Partial<Record<string, unknown>> = {}) {
  n += 1;
  const tag = `rg${Date.now().toString(36)}${n}`;
  return {
    email: `${tag}@example.test`,
    username: tag,
    password: PLAYER_PASSWORD,
    confirmPassword: PLAYER_PASSWORD,
    ageConfirmed: true as const,
    chipsAcknowledged: true as const,
    termsAccepted: true as const,
    ...overrides,
  };
}

const registerNow = (raw = input()) => withMailbox(() => register(raw as Parameters<typeof register>[0], meta));

/** Moves the latest challenge's creation back so the resend cooldown has passed. */
async function pastCooldown(userId: string) {
  await getDb().execute(sql`UPDATE email_verification_challenges SET created_at = created_at - interval '61 seconds' WHERE user_id = ${userId}`);
}

function isoDaysAgo(years: number, plusDays = 0): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + plusDays));
  return d.toISOString().slice(0, 10);
}

afterEach(() => {
  failNextDeliveries(0);
  vi.restoreAllMocks();
});

describe('step 1: registration creates a pending account only', () => {
  it('no session, wallet, seeds or chips before verification; the code is only in the e-mail', async () => {
    const raw = input();
    const res = await registerNow(raw);
    expect(res.sent).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/\b\d{6}\b(?![0-9a-f-])/);
    expect(readFlowToken(res.flow.token)).toBe(res.user.id);
    const [u] = await getDb().select().from(users).where(eq(users.id, res.user.id));
    expect(u!.emailVerifiedAt).toBeNull();
    expect(u!.onboardingRequired).toBe(true);
    expect(u!.termsVersion).toBeTruthy();
    expect(u!.privacyVersion).toBeTruthy();
    expect(await getWalletAccount(getDb(), res.user.id)).toBeFalsy();
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, res.user.id))).toHaveLength(0);
    expect(await getDb().select().from(seedPairs).where(eq(seedPairs.userId, res.user.id))).toHaveLength(0);
    expect(await getDb().select().from(bonuses).where(eq(bonuses.userId, res.user.id))).toHaveLength(0);
    const [challenge] = await getDb().select().from(emailVerificationChallenges).where(eq(emailVerificationChallenges.userId, res.user.id));
    const sent = latestCode(raw.email);
    expect(challenge!.codeMac).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge!.codeMac).not.toContain(sent);
    expect(challenge!.expiresAt.getTime() - challenge!.createdAt.getTime()).toBe(10 * 60_000);
    expect(challenge!.delivery).toBe('SENT');
  });

  it('the HTTP response sets only the signup-flow cookie and never contains the code', async () => {
    const raw = input();
    const res = await withMailbox(() =>
      registerRoute(new NextRequest(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': '10.9.0.1' }, body: JSON.stringify(raw) }), {
        params: Promise.resolve({}),
      }),
    );
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(latestCode(raw.email));
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${FLOW_COOKIE_DEV}=`);
    expect(cookie).not.toContain(`${SESSION_COOKIE_DEV}=`);
    expect(cookie.toLowerCase()).toContain('httponly');
    const body = JSON.parse(text);
    expect(body.verification.email).toBe(raw.email);
  });

  it('validates every field on the server', async () => {
    await expect(registerNow(input({ confirmPassword: 'something else entirely' }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR' && JSON.stringify((e as AppError).details).includes('confirmPassword'));
    await expect(registerNow(input({ email: 'not-an-email' }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    await expect(registerNow(input({ username: 'a b' }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    await expect(registerNow(input({ chipsAcknowledged: false }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    await expect(registerNow(input({ termsAccepted: false }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    await expect(registerNow(input({ ageConfirmed: false }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    await expect(registerNow(input({ password: 'short', confirmPassword: 'short' }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    // No role, status or verification can be smuggled in.
    await expect(registerNow(input({ role: 'OWNER' }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
    await expect(registerNow(input({ emailVerifiedAt: new Date().toISOString() }))).rejects.toSatisfy((e) => code(e) === 'VALIDATION_ERROR');
  });

  it('reports a taken username and a duplicate e-mail by field', async () => {
    const first = input();
    await registerNow(first);
    const taken = await registerNow(input({ username: first.username })).catch((e) => e);
    expect(code(taken)).toBe('CONFLICT');
    expect((taken as AppError).details?.field).toBe('username');
    const dup = await registerNow(input({ email: first.email.toUpperCase() })).catch((e) => e);
    expect(code(dup)).toBe('CONFLICT');
    expect((dup as AppError).details?.field).toBe('email');
  });

  it('a stale unverified registration no longer blocks its e-mail or username', async () => {
    const stale = input();
    const old = await registerNow(stale);
    await getDb().execute(sql`UPDATE users SET created_at = now() - interval '25 hours' WHERE id = ${old.user.id}`);
    const again = await registerNow(input({ email: stale.email, username: stale.username }));
    expect(again.user.id).not.toBe(old.user.id);
    const [gone] = await getDb().select().from(users).where(eq(users.id, old.user.id));
    expect(gone!.status).toBe('DELETED');
    expect(gone!.email).not.toBe(stale.email);
  });

  it('refuses registration outright when this server cannot send e-mail (nothing is created)', async () => {
    const raw = input();
    // Default integration configuration: MAIL_TRANSPORT=disabled.
    await expect(register(raw, meta)).rejects.toSatisfy((e) => code(e) === 'SERVICE_UNAVAILABLE');
    expect(await getDb().select().from(users).where(eq(users.email, raw.email))).toHaveLength(0);
  });

  it('a failed delivery leaves a recoverable pending account and allows an immediate resend', async () => {
    const raw = input();
    failNextDeliveries(1);
    const res = await registerNow(raw);
    expect(res.sent).toBe(false);
    expect(messagesTo(raw.email)).toHaveLength(0);
    const status = await signupStatus(res.user.id);
    expect(status!.sent).toBe(false);
    expect(new Date(status!.resendAvailableAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const resent = await withMailbox(() => resendSignupCode(res.user.id, meta));
    expect(resent.sent).toBe(true);
    const ok = await verifySignupCode(res.user.id, latestCode(raw.email), meta);
    expect(ok.session.token).toBeTruthy();
  });
});

describe('step 2: verification codes', () => {
  it('counts wrong codes and locks the challenge after five', async () => {
    const raw = input();
    const res = await registerNow(raw);
    const right = latestCode(raw.email);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 0; left -= 1) {
      const err = await verifySignupCode(res.user.id, wrong, meta).catch((e) => e);
      expect(code(err)).toBe('VALIDATION_ERROR');
      expect((err as AppError).details?.attemptsLeft).toBe(left);
    }
    // Even the right code is refused now; a new code is needed.
    expect(reason(await verifySignupCode(res.user.id, right, meta).catch((e) => e))).toBe('too_many_attempts');
    await pastCooldown(res.user.id);
    await withMailbox(() => resendSignupCode(res.user.id, meta));
    const fresh = latestCode(raw.email);
    expect((await verifySignupCode(res.user.id, fresh, meta)).user.id).toBe(res.user.id);
    const failures = await getDb().select().from(auditLogs).where(and(eq(auditLogs.actorId, res.user.id), eq(auditLogs.action, 'auth.email_verification_failed')));
    expect(failures.length).toBe(6);
  });

  it('rejects malformed codes without spending an attempt', async () => {
    const raw = input();
    const res = await registerNow(raw);
    expect(reason(await verifySignupCode(res.user.id, '12345', meta).catch((e) => e))).toBe('format');
    expect(reason(await verifySignupCode(res.user.id, 'abcdef', meta).catch((e) => e))).toBe('format');
    expect((await signupStatus(res.user.id))!.attemptsLeft).toBe(5);
  });

  it('expired codes are refused', async () => {
    const raw = input();
    const res = await registerNow(raw);
    await getDb().execute(sql`UPDATE email_verification_challenges SET created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' WHERE user_id = ${res.user.id}`);
    expect(reason(await verifySignupCode(res.user.id, latestCode(raw.email), meta).catch((e) => e))).toBe('expired');
  });

  it('resend has a cooldown, supersedes the previous code and has an hourly cap', async () => {
    const raw = input();
    const res = await registerNow(raw);
    const first = latestCode(raw.email);
    const early = await withMailbox(() => resendSignupCode(res.user.id, meta)).catch((e) => e);
    expect(code(early)).toBe('RATE_LIMITED');
    expect((early as AppError).details?.retryAfterSeconds).toBeGreaterThan(50);
    for (let i = 0; i < 4; i += 1) {
      await pastCooldown(res.user.id);
      await withMailbox(() => resendSignupCode(res.user.id, meta));
    }
    const latest = latestCode(raw.email);
    // Five codes this hour: the sixth waits.
    await pastCooldown(res.user.id);
    expect(code(await withMailbox(() => resendSignupCode(res.user.id, meta)).catch((e) => e))).toBe('RATE_LIMITED');
    if (first !== latest) expect(reason(await verifySignupCode(res.user.id, first, meta).catch((e) => e))).toBe('incorrect');
    const live = await getDb()
      .select()
      .from(emailVerificationChallenges)
      .where(and(eq(emailVerificationChallenges.userId, res.user.id), sql`consumed_at IS NULL AND superseded_at IS NULL`));
    expect(live).toHaveLength(1);
    await verifySignupCode(res.user.id, latest, meta);
  });

  it('a consumed code cannot be used again', async () => {
    const raw = input();
    const res = await registerNow(raw);
    const c = latestCode(raw.email);
    await verifySignupCode(res.user.id, c, meta);
    expect(reason(await verifySignupCode(res.user.id, c, meta).catch((e) => e))).toBe('already_verified');
  });

  it('concurrent correct submissions activate the account exactly once', async () => {
    const raw = input();
    const res = await registerNow(raw);
    const c = latestCode(raw.email);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => verifySignupCode(res.user.id, c, meta)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await getDb().select().from(ledgerAccounts).where(and(eq(ledgerAccounts.userId, res.user.id), eq(ledgerAccounts.type, 'PLAYER_WALLET')))).toHaveLength(1);
    expect(await getDb().select().from(bonuses).where(and(eq(bonuses.userId, res.user.id), eq(bonuses.type, 'SIGNUP')))).toHaveLength(1);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, res.user.id))).toHaveLength(1);
    expect((await getWalletAccount(getDb(), res.user.id))!.balance).toBe(1_000_000);
    await expectLedgerConsistent();
  });

  it('the verification endpoint acts only on the pending account named by the signed cookie', async () => {
    const raw = input();
    const res = await registerNow(raw);
    const call = (cookie: string | null, body: unknown) =>
      verifyRoute(
        new NextRequest(`${BASE}/api/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }),
        { params: Promise.resolve({}) },
      );
    expect((await call(null, { code: latestCode(raw.email) })).status).toBe(401);
    const forged = `${res.flow.token.split('.')[0]}.AAAA`;
    expect((await call(`${FLOW_COOKIE_DEV}=${forged}`, { code: latestCode(raw.email) })).status).toBe(401);
    // A user id in the body is not accepted at all.
    expect((await call(`${FLOW_COOKIE_DEV}=${res.flow.token}`, { code: latestCode(raw.email), userId: res.user.id })).status).toBe(400);
    const status = await verifyStatusRoute(new NextRequest(`${BASE}/api/auth/verify-email`, { headers: { cookie: `${FLOW_COOKIE_DEV}=${res.flow.token}` } }), { params: Promise.resolve({}) });
    expect(JSON.stringify(await status.json())).not.toContain(latestCode(raw.email));
    const ok = await call(`${FLOW_COOKIE_DEV}=${res.flow.token}`, { code: latestCode(raw.email) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_DEV}=`);
  });

  it('the address can be corrected before verification; the old code stops working', async () => {
    const raw = input();
    const res = await registerNow(raw);
    const oldCode = latestCode(raw.email);
    const taken = (await newPlayer('taken')).email;
    await pastCooldown(res.user.id);
    expect(code(await withMailbox(() => changeSignupEmail(res.user.id, taken, meta)).catch((e) => e))).toBe('CONFLICT');
    const corrected = raw.email.replace('@', '.fixed@');
    await pastCooldown(res.user.id);
    await withMailbox(() => changeSignupEmail(res.user.id, corrected, meta));
    if (oldCode !== latestCode(corrected)) expect(code(await verifySignupCode(res.user.id, oldCode, meta).catch((e) => e))).toBe('VALIDATION_ERROR');
    const ok = await verifySignupCode(res.user.id, latestCode(corrected), meta);
    expect(ok.user.email).toBe(corrected);
  });
});

describe('signup-flow cookie', () => {
  it('is signed, expires, and cannot be altered to name another account', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const { token } = issueFlowToken(id, Date.now());
    expect(readFlowToken(token)).toBe(id);
    expect(readFlowToken(token, Date.now() + 25 * 3600_000)).toBeNull();
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: '99999999-2222-4333-8444-555555555555', e: Date.now() + 3600_000 })).toString('base64url');
    expect(readFlowToken(`${forged}.${mac}`)).toBeNull();
    expect(readFlowToken(`${payload}.${mac!.slice(0, -2)}AA`)).toBeNull();
    expect(readFlowToken('garbage')).toBeNull();
  });
});

describe('sign-in before verification', () => {
  it('a correct password yields no session but the verification step; a wrong one stays generic', async () => {
    const raw = input();
    const res = await registerNow(raw);
    const before = sentMail.length;
    const err = await withMailbox(() => login(raw.email, PLAYER_PASSWORD, meta)).catch((e) => e);
    expect(err).toBeInstanceOf(VerificationRequiredError);
    expect(readFlowToken((err as VerificationRequiredError).flow.token)).toBe(res.user.id);
    expect(sentMail.length).toBe(before); // the registration code is still live
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, res.user.id))).toHaveLength(0);
    const wrong = await login(raw.email, 'definitely not it', meta).catch((e) => e);
    expect(code(wrong)).toBe('UNAUTHENTICATED');
    // Expired code: signing in sends a fresh one (within the limits).
    await getDb().execute(sql`UPDATE email_verification_challenges SET created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' WHERE user_id = ${res.user.id}`);
    await withMailbox(() => login(raw.email, PLAYER_PASSWORD, meta)).catch(() => undefined);
    expect(messagesTo(raw.email)).toHaveLength(2);
    await verifySignupCode(res.user.id, latestCode(raw.email), meta);
  });
});

describe('step 3: onboarding', () => {
  it('a verified account is pending onboarding until the profile is complete', async () => {
    const p = await newPlayer('ob', { stopAt: 'verified' });
    expect((await resolveSession(p.token))!.onboardingPending).toBe(true);
    await completeOnboarding(p.userId, ONBOARDING_SAMPLE, meta);
    expect((await resolveSession(p.token))!.onboardingPending).toBe(false);
    const d = await accountDetails(p.userId);
    expect(d.firstName).toBe('Ana María');
    expect(d.lastName).toBe("O'Connor-Nguyễn");
    expect(d.phoneE164).toBe('+442079460018');
    expect(d.phoneVerified).toBe(false);
    expect(d.countryCode).toBe('GB');
    expect(d.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(code(await completeOnboarding(p.userId, ONBOARDING_SAMPLE, meta).catch((e) => e))).toBe('CONFLICT');
  });

  it('validates names, dates, the minimum age, country and phone on the server', async () => {
    const p = await newPlayer('obv', { stopAt: 'verified' });
    const bad = async (patch: Record<string, unknown>) => {
      const err = await completeOnboarding(p.userId, { ...ONBOARDING_SAMPLE, ...patch }, meta).catch((e) => e);
      expect(code(err)).toBe('VALIDATION_ERROR');
      return JSON.stringify((err as AppError).details);
    };
    expect(await bad({ dateOfBirth: '2001-02-29' })).toContain('valid date');
    expect(await bad({ dateOfBirth: '1990-13-01' })).toContain('valid date');
    expect(await bad({ dateOfBirth: '15/04/1990' })).toContain('valid date');
    expect(await bad({ dateOfBirth: isoDaysAgo(18, 1) })).toContain('at least 18');
    expect(await bad({ dateOfBirth: isoDaysAgo(-1) })).toContain('future');
    expect(await bad({ dateOfBirth: '1850-01-01' })).toContain('year');
    expect(await bad({ countryCode: 'XX' })).toContain('country');
    expect(await bad({ countryCode: 'gbr' })).toContain('country');
    expect(await bad({ phoneNumber: '12' })).toContain('phone');
    expect(await bad({ phoneRegion: 'ZZ' })).toContain('phone');
    expect(await bad({ firstName: '   ' })).toContain('first name');
    expect(await bad({ lastName: 'R2-D2' })).toContain('last name');
    expect(await bad({ firstName: 'x'.repeat(65) })).toContain('first name');
    expect(await bad({ firstName: undefined })).toContain('firstName');
    expect(await bad({ role: 'ADMIN' })).toContain('role');
    // Exactly 18 today is accepted.
    await completeOnboarding(p.userId, { ...ONBOARDING_SAMPLE, dateOfBirth: isoDaysAgo(18), firstName: '  Zoë   Ann ', lastName: '李' }, meta);
    const d = await accountDetails(p.userId);
    expect(d.firstName).toBe('Zoë Ann');
    expect(d.lastName).toBe('李');
  });

  it('normalises international and national phone formats to E.164', () => {
    expect(normalisePhone('GB', '020 7946 0018')).toBe('+442079460018');
    expect(normalisePhone('GB', '+33 6 12 34 56 78')).toBe('+33612345678');
    expect(normalisePhone('US', '(201) 555-0123')).toBe('+12015550123');
    expect(() => normalisePhone('DE', '000')).toThrow(AppError);
    expect(() => normalisePhone('GB', 'call me')).toThrow(AppError);
  });

  it('settings edits keep the phone unverified, and the date of birth is set only once', async () => {
    const p = await newPlayer('obs');
    await getDb().update(users).set({ phoneVerifiedAt: new Date() }).where(eq(users.id, p.userId));
    const d = await updateAccountDetails(p.userId, { phoneRegion: 'FR', phoneNumber: '6 12 34 56 78', countryCode: 'FR' }, meta);
    expect(d.phoneE164).toBe('+33612345678');
    expect(d.phoneVerified).toBe(false);
    expect(code(await updateAccountDetails(p.userId, { dateOfBirth: '1980-01-01' }, meta).catch((e) => e))).toBe('VALIDATION_ERROR');
  });
});

describe('server-side gates while onboarding is pending', () => {
  /** Every API route file, with the handler methods it exports. */
  const apiRoot = path.resolve(__dirname, '../../src/app/api');
  function routeFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? routeFiles(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : []));
  }
  /** Routes a pending player may use: public auth flows, sign-out, reading their own account, profile, export, deletion, password and e-mail changes, onboarding itself. */
  const OPEN = new Set([
    'auth/login',
    'auth/login/mfa',
    'auth/register',
    'auth/password/forgot',
    'auth/password/reset',
    'auth/verify-email',
    'auth/verify-email/resend',
    'auth/verify-email/change-email',
    'auth/logout',
    'auth/me',
    'onboarding',
    'account',
    'account/profile',
    'account/export',
    'account/password',
    'account/email',
    'account/email/confirm',
    'games',
    'games/[gameId]',
    'sports/events',
    'sports/events/[eventId]',
    'health',
    'health/ready',
    'metrics',
  ]);

  it('every other API route answers 403 ONBOARDING_REQUIRED', async () => {
    const p = await newPlayer('gate', { stopAt: 'verified' });
    const checked: string[] = [];
    for (const file of routeFiles(apiRoot)) {
      const rel = path.relative(apiRoot, path.dirname(file)).split(path.sep).join('/');
      if (OPEN.has(rel)) continue;
      const mod = (await import(file)) as Record<string, (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>;
      const urlPath = rel.replace(/\[(\w+)\]/g, '00000000-0000-4000-8000-000000000000');
      const params = Object.fromEntries([...rel.matchAll(/\[(\w+)\]/g)].map((m) => [m[1]!, m[1] === 'gameId' ? 'dice' : '00000000-0000-4000-8000-000000000000']));
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        const handler = mod[method];
        if (!handler) continue;
        const headers: Record<string, string> = { cookie: `${SESSION_COOKIE_DEV}=${p.token}`, 'idempotency-key': crypto.randomUUID() };
        if (method !== 'GET') Object.assign(headers, { origin: BASE, 'content-type': 'application/json' });
        const res = await handler(new NextRequest(`${BASE}/api/${urlPath}`, { method, headers, body: method === 'GET' ? undefined : '{}' }), { params: Promise.resolve(params) });
        expect({ route: `${method} ${rel}`, status: res.status }).toEqual({ route: `${method} ${rel}`, status: 403 });
        expect((await res.json()).error.code).toBe('ONBOARDING_REQUIRED');
        checked.push(`${method} ${rel}`);
      }
    }
    expect(checked.length).toBeGreaterThan(50);
    expect(checked).toEqual(expect.arrayContaining(['GET wallet', 'POST games/[gameId]/rounds', 'POST sports/tickets', 'POST wallet/daily-bonus', 'GET admin/overview']));
  });

  it('the same routes work once onboarding is complete', async () => {
    const p = await newPlayer('gate2', { stopAt: 'verified' });
    const { GET } = await import('@/app/api/wallet/route');
    const call = () => GET(new NextRequest(`${BASE}/api/wallet`, { headers: { cookie: `${SESSION_COOKIE_DEV}=${p.token}` } }), { params: Promise.resolve({}) });
    expect((await call()).status).toBe(403);
    await completeOnboarding(p.userId, ONBOARDING_SAMPLE, meta);
    const ok = await call();
    expect(ok.status).toBe(200);
    expect((await ok.json()).balance).toBe(1_000_000);
  });
});

describe('existing and operator-created accounts', () => {
  it('pre-migration accounts (grandfathered) keep signing in and playing without onboarding', async () => {
    const op = await createOperatorAccount({ email: `legacy${Date.now()}@example.test`, username: `legacy${Date.now().toString(36)}`, password: PLAYER_PASSWORD }, meta, { onboarding: 'exempt' });
    // Exactly what migration 0009 leaves on a pre-existing row.
    await getDb().update(users).set({ emailVerificationMethod: 'LEGACY_MIGRATION', onboardingRequired: false, termsVersion: null, termsAcceptedAt: null, privacyVersion: null, privacyAcceptedAt: null }).where(eq(users.id, op.user.id));
    const res = await login(op.user.email, PLAYER_PASSWORD, meta);
    expect(res.onboardingPending).toBe(false);
    expect((await resolveSession(res.session.token))!.onboardingPending).toBe(false);
    const d = await accountDetails(op.user.id);
    expect(d.firstName).toBeNull(); // nothing invented
    expect(d.emailVerificationMethod).toBe('LEGACY_MIGRATION');
  });

  it('operator-created accounts can be required to onboard', async () => {
    const op = await createOperatorAccount({ email: `opreq${Date.now()}@example.test`, username: `opreq${Date.now().toString(36)}`, password: PLAYER_PASSWORD }, meta, { onboarding: 'required', session: true });
    expect((await resolveSession(op.session!.token))!.onboardingPending).toBe(true);
    expect((await getWalletAccount(getDb(), op.user.id))!.balance).toBe(1_000_000);
  });
});

describe('changing the e-mail of a verified account', () => {
  it('needs the password and a code from the new address; other sessions end and the old address is told', async () => {
    const p = await newPlayer('chg');
    const other = await login(p.email, PLAYER_PASSWORD, meta);
    const next = p.email.replace('@', '.new@');
    expect(code(await withMailbox(() => requestEmailChange(p.userId, next, 'wrong password!!', meta)).catch((e) => e))).toBe('UNAUTHENTICATED');
    const taken = (await newPlayer('chgtaken')).email;
    expect(code(await withMailbox(() => requestEmailChange(p.userId, taken, PLAYER_PASSWORD, meta)).catch((e) => e))).toBe('CONFLICT');
    await withMailbox(() => requestEmailChange(p.userId, next, PLAYER_PASSWORD, meta));
    const [still] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, p.userId));
    expect(still!.email).toBe(p.email); // unchanged until confirmed
    const done = await withMailbox(async () => {
      const r = await confirmEmailChange(p.userId, p.sessionId, latestCode(next), meta);
      await import('@/server/mail/mailer').then((m) => m.flushMail());
      return r;
    });
    expect(done.email).toBe(next);
    expect(await resolveSession(other.session.token)).toBeNull();
    expect(await resolveSession(p.token)).not.toBeNull();
    expect(messagesTo(p.email).at(-1)!.subject).toContain('was changed');
    expect(messagesTo(p.email).at(-1)!.text).not.toContain(next);
  });
});

describe('privacy: export, deletion, audit records and logs', () => {
  it('export includes the new fields and verification history but never a code or verifier', async () => {
    const p = await newPlayer('exp');
    const data = await exportUserData(p.userId);
    expect(data.user).toMatchObject({ firstName: 'Ana María', countryCode: 'GB', phoneE164: '+442079460018', dateOfBirth: '1990-04-15', onboardingRequired: true });
    expect(data.emailVerifications.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toMatch(/codeMac|code_mac/);
    expect(JSON.stringify(data)).not.toContain(latestCode(p.email));
  });

  it('deletion erases names, birth date, country, phone and verification addresses', async () => {
    const p = await newPlayer('delob');
    await deleteAccount(p.userId, PLAYER_PASSWORD, meta);
    const [u] = await getDb().select().from(users).where(eq(users.id, p.userId));
    expect([u!.firstName, u!.lastName, u!.dateOfBirth, u!.countryCode, u!.phoneE164]).toEqual([null, null, null, null, null]);
    const challenges = await getDb().select().from(emailVerificationChallenges).where(eq(emailVerificationChallenges.userId, p.userId));
    expect(challenges.every((c) => c.email === 'erased@deleted.invalid')).toBe(true);
    await expectLedgerConsistent();
  });

  it('audit records and logs carry no codes, names, birth dates, phone numbers or addresses', async () => {
    const lines: string[] = [];
    const capture = (chunk: unknown) => (lines.push(String(chunk)), true);
    vi.spyOn(process.stdout, 'write').mockImplementation(capture as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture as typeof process.stderr.write);
    const raw = input();
    failNextDeliveries(1); // also exercises the delivery-failure log line
    const res = await registerNow(raw);
    await withMailbox(() => resendSignupCode(res.user.id, meta));
    const c = latestCode(raw.email);
    await verifySignupCode(res.user.id, c === '000000' ? '111111' : '000000', meta).catch(() => undefined);
    await verifySignupCode(res.user.id, c, meta);
    await completeOnboarding(res.user.id, ONBOARDING_SAMPLE, meta);
    vi.restoreAllMocks();
    const audit = await getDb().select().from(auditLogs).where(eq(auditLogs.actorId, res.user.id));
    const haystack = JSON.stringify(audit) + lines.join('\n');
    for (const secret of [c, raw.email, 'Ana María', "O'Connor", '1990-04-15', '+442079460018', '7946 0018']) expect(haystack).not.toContain(secret);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['user.registered', 'auth.verification_code_sent', 'auth.email_verification_failed', 'user.email_verified', 'user.onboarding_completed']));
  });
});

describe('mail transports', () => {
  it('a transport that only prints (development console) still lets registration proceed honestly', async () => {
    const printed: string[] = [];
    const consoleLike: Mailer = { kind: 'console', deliversEmail: false, send: async (m) => void printed.push(m.text) };
    setMailerForTests(consoleLike);
    try {
      const raw = input();
      const res = await register(raw, meta);
      expect(res.sent).toBe(true);
      expect((await signupStatus(res.user.id))!.delivery).toBe('console');
      expect(printed).toHaveLength(1);
    } finally {
      setMailerForTests(null);
    }
  });
});
