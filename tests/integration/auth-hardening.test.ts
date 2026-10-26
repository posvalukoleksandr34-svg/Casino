/**
 * Authentication and session hardening through the real route handlers:
 * per-IP rate limits, session revocation and expiry, reset-link invalidation,
 * and authorisation of admin financial endpoints.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as adjustRoute } from '@/app/api/admin/users/[userId]/adjust/route';
import { POST as forgotRoute } from '@/app/api/auth/password/forgot/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { POST as startRoundRoute } from '@/app/api/games/[gameId]/rounds/route';
import { resolveSession, SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { sha256Hex } from '@/server/crypto';
import { getDb } from '@/server/db/client';
import { ledgerTransactions, passwordResetTokens, sessions } from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { changePassword, resetPassword } from '@/server/users/accounts';
import { key, newPlayer } from './helpers';

const BASE = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const meta = { ipHash: null, userAgent: 'vitest' };
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, ...headers },
    body: JSON.stringify(body),
  });
}
const cookie = (token: string) => ({ cookie: `${SESSION_COOKIE_DEV}=${token}` });
/** A unique client address per test (documentation range, RFC 5737), seen through one trusted proxy. */
const ip = () => ({ 'x-forwarded-for': `198.51.100.${randomInt(1, 255)}, 10.0.0.${randomInt(1, 255)}` });

describe('per-IP rate limits (one trusted proxy)', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.TRUST_PROXY_HOPS;
    process.env.TRUST_PROXY_HOPS = '1';
    resetEnvCache();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = saved;
    resetEnvCache();
  });

  it('login: the 21st attempt from one address within 5 minutes is refused; another address is not', async () => {
    const p = await newPlayer('rl');
    // Same client address for all attempts: the proxy appends its own peer last.
    const client = `203.0.113.${randomInt(1, 255)}`;
    const from = { 'x-forwarded-for': `${client}, 10.9.9.9` };
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const res = await loginRoute(post('/api/auth/login', { email: p.email, password: 'wrong password!' }, from), params({}));
      statuses.push(res.status);
      if (res.status === 429) expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
    // A different client is unaffected (the account itself may now be locked: not 429).
    const other = await loginRoute(post('/api/auth/login', { email: p.email, password: PASSWORD }, ip()), params({}));
    expect(other.status).not.toBe(429);
  });

  it('password-reset requests: the 6th from one address within 15 minutes is refused', async () => {
    const from = ip();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await forgotRoute(post('/api/auth/password/forgot', { email: `nobody-${randomUUID()}@example.test` }, from), params({}))).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});

describe('sessions', () => {
  it('logout revokes the session: replaying its cookie is unauthenticated everywhere', async () => {
    const p = await newPlayer('logout');
    const me = async () => (await (await meRoute(new NextRequest(`${BASE}/api/auth/me`, { headers: cookie(p.token) }), params({}))).json()) as { user: { id: string } | null };
    expect((await me()).user?.id).toBe(p.userId);
    expect((await logoutRoute(post('/api/auth/logout', {}, cookie(p.token)), params({}))).status).toBe(200);
    expect((await me()).user).toBeNull(); // /api/auth/me is optional-auth: it reports "signed out"
    expect(await resolveSession(p.token)).toBeNull();
    const wager = await startRoundRoute(
      post('/api/games/dice/rounds', { bet: { amount: 100, target: 5000, direction: 'under' } }, { ...cookie(p.token), 'idempotency-key': key() }),
      params({ gameId: 'dice' }),
    );
    expect(wager.status).toBe(401);
    const placed = await getDb().select().from(ledgerTransactions).where(and(eq(ledgerTransactions.userId, p.userId), eq(ledgerTransactions.type, 'BET_PLACED')));
    expect(placed).toHaveLength(0);
  });

  it('absolute expiry ends a session even while it is in use', async () => {
    const p = await newPlayer('absexp');
    expect(await resolveSession(p.token)).not.toBeNull();
    await getDb().update(sessions).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(sessions.id, p.sessionId));
    expect(await resolveSession(p.token)).toBeNull();
  });

  it('a session token is stored only as its hash', async () => {
    const p = await newPlayer('hash');
    const [row] = await getDb().select().from(sessions).where(eq(sessions.id, p.sessionId));
    expect(row!.tokenHash).toBe(sha256Hex(p.token));
    expect(JSON.stringify(row)).not.toContain(p.token);
  });
});

describe('password reset links', () => {
  it('changing the password invalidates every outstanding reset link', async () => {
    const p = await newPlayer('chgreset');
    const token = `outstanding-${randomUUID()}`;
    await getDb().insert(passwordResetTokens).values({ userId: p.userId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
    await changePassword(p.userId, p.sessionId, PASSWORD, 'a brand new passphrase 1', meta);
    const open = await getDb()
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, p.userId), isNull(passwordResetTokens.usedAt)));
    expect(open).toHaveLength(0);
    await expect(resetPassword(token, 'attacker chosen passphrase', meta)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('admin financial endpoints', () => {
  it('a player cannot adjust balances (403) and nothing is posted', async () => {
    const p = await newPlayer('noadj');
    const res = await adjustRoute(
      post(`/api/admin/users/${p.userId}/adjust`, { amount: 1_000_000, reason: 'give me chips' }, { ...cookie(p.token), 'idempotency-key': key() }),
      params({ userId: p.userId }),
    );
    expect(res.status).toBe(403);
    const adjustments = await getDb().select().from(ledgerTransactions).where(and(eq(ledgerTransactions.userId, p.userId), eq(ledgerTransactions.type, 'ADJUSTMENT')));
    expect(adjustments).toHaveLength(0);
    // Unauthenticated: 401.
    const anon = await adjustRoute(post(`/api/admin/users/${p.userId}/adjust`, { amount: 1, reason: 'anonymous try' }, { 'idempotency-key': key() }), params({ userId: p.userId }));
    expect(anon.status).toBe(401);
  });
});

describe('expensive staff endpoints', () => {
  it('manual reconciliation runs are rate-limited per staff member; players are refused outright', async () => {
    const { POST: reconcileRoute } = await import('@/app/api/admin/reconciliation/route');
    const { users } = await import('@/server/db/schema');
    const staff = await newPlayer('recon');
    await getDb().update(users).set({ role: 'ADMIN' }).where(eq(users.id, staff.userId));
    const player = await newPlayer('reconp');
    expect((await reconcileRoute(post('/api/admin/reconciliation', {}, cookie(player.token)), params({}))).status).toBe(403);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await reconcileRoute(post('/api/admin/reconciliation', {}, cookie(staff.token)), params({}))).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});
