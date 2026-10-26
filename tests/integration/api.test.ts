import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST as startRoundRoute } from '@/app/api/games/[gameId]/rounds/route';
import { GET as overviewRoute } from '@/app/api/admin/overview/route';
import { POST as voidRoute } from '@/app/api/admin/rounds/[roundId]/void/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { GET as walletRoute } from '@/app/api/wallet/route';
import { GET as metricsRoute } from '@/app/api/metrics/route';
import { GET as healthRoute } from '@/app/api/health/ready/route';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { resetEnvCache } from '@/server/env';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { newPlayer } from './helpers';

const BASE = 'http://localhost:3000';

function req(path: string, opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] ??= 'application/json';
  if (opts.token) headers.cookie = `${SESSION_COOKIE_DEV}=${opts.token}`;
  if (opts.method && opts.method !== 'GET') headers.origin ??= BASE;
  return new NextRequest(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const diceBet = { bet: { amount: 100, target: 5000, direction: 'under' } };

describe('API: authentication and authorisation', () => {
  it('rejects wagers without a session (401) and reports me = null', async () => {
    const res = await startRoundRoute(req('/api/games/dice/rounds', { method: 'POST', body: diceBet, headers: { 'idempotency-key': randomUUID() } }), params({ gameId: 'dice' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    const me = await meRoute(req('/api/auth/me'), params({}));
    expect(await me.json()).toEqual({ user: null });
  });

  it('players cannot reach admin endpoints (403)', async () => {
    const p = await newPlayer('apirbac');
    const res = await overviewRoute(req('/api/admin/overview', { token: p.token }), params({}));
    expect(res.status).toBe(403);
    const v = await voidRoute(req(`/api/admin/rounds/${randomUUID()}/void`, { method: 'POST', token: p.token, body: { reason: 'trying to void' } }), params({ roundId: randomUUID() }));
    expect(v.status).toBe(403);
  });

  it('login sets an HttpOnly SameSite session cookie', async () => {
    const p = await newPlayer('apilogin');
    const res = await loginRoute(req('/api/auth/login', { method: 'POST', body: { email: p.email, password: 'correct horse battery staple' }, headers: { 'x-forwarded-for': '10.1.0.1' } }), params({}));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE_DEV}=`);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
  });
});

describe('API: CSRF and request validation', () => {
  it('rejects cross-origin state-changing requests', async () => {
    const p = await newPlayer('apicsrf');
    const res = await startRoundRoute(
      req('/api/games/dice/rounds', { method: 'POST', body: diceBet, token: p.token, headers: { origin: 'https://evil.example', 'idempotency-key': randomUUID() } }),
      params({ gameId: 'dice' }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('CSRF_REJECTED');
    const site = await startRoundRoute(
      req('/api/games/dice/rounds', { method: 'POST', body: diceBet, token: p.token, headers: { 'sec-fetch-site': 'cross-site', 'idempotency-key': randomUUID() } }),
      params({ gameId: 'dice' }),
    );
    expect(site.status).toBe(403);
  });

  it('requires JSON, an Idempotency-Key, and a valid bet', async () => {
    const p = await newPlayer('apival');
    const noKey = await startRoundRoute(req('/api/games/dice/rounds', { method: 'POST', body: diceBet, token: p.token }), params({ gameId: 'dice' }));
    expect(noKey.status).toBe(400);
    const notJson = await startRoundRoute(
      req('/api/games/dice/rounds', { method: 'POST', body: diceBet, token: p.token, headers: { 'content-type': 'text/plain', 'idempotency-key': randomUUID() } }),
      params({ gameId: 'dice' }),
    );
    expect(notJson.status).toBe(400);
    const bad = await startRoundRoute(
      req('/api/games/dice/rounds', { method: 'POST', body: { bet: { amount: -5, target: 5000, direction: 'under' } }, token: p.token, headers: { 'idempotency-key': randomUUID() } }),
      params({ gameId: 'dice' }),
    );
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.requestId).toBeTruthy();
  });

  it('a client cannot inject an outcome or payout field', async () => {
    const p = await newPlayer('apiinject');
    const res = await startRoundRoute(
      req('/api/games/dice/rounds', { method: 'POST', body: { bet: { ...diceBet.bet, roll: 0, payout: 999999 } }, token: p.token, headers: { 'idempotency-key': randomUUID() } }),
      params({ gameId: 'dice' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('API: wagering', () => {
  it('places a wager (201), replays it idempotently and updates the wallet once', async () => {
    const p = await newPlayer('apibet');
    const k = randomUUID();
    const first = await startRoundRoute(req('/api/games/dice/rounds', { method: 'POST', body: diceBet, token: p.token, headers: { 'idempotency-key': k } }), params({ gameId: 'dice' }));
    expect(first.status).toBe(201);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const a = await first.json();
    const second = await startRoundRoute(req('/api/games/dice/rounds', { method: 'POST', body: diceBet, token: p.token, headers: { 'idempotency-key': k } }), params({ gameId: 'dice' }));
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    const b = await second.json();
    expect(b.round.id).toBe(a.round.id);
    const wallet = await (await walletRoute(req('/api/wallet', { token: p.token }), params({}))).json();
    expect(wallet.balance).toBe(1_000_000 - 100 + (a.round.payout ?? 0));
    // No secret material is ever returned.
    expect(JSON.stringify(a)).not.toMatch(/serverSeedEnc|revealedServerSeed/);
    expect(a.round.fairness.serverSeed).toBeNull();
  });

  it('rate-limits bursts of wagers per user', async () => {
    const p = await newPlayer('apirate');
    const statuses: number[] = [];
    // Fixed 10-second windows: a burst of 34 could straddle a boundary (e.g. 20 + 14) and
    // never exceed 30 in either. 2 × limit + 1 requests always put 31 in one window
    // (the burst takes well under 10 s, so it spans at most two).
    const attempts = 2 * RATE_LIMITS.betUser.limit + 1;
    for (let i = 0; i < attempts; i += 1) {
      const res = await startRoundRoute(req('/api/games/dice/rounds', { method: 'POST', body: { bet: { amount: 10, target: 5000, direction: 'under' } }, token: p.token, headers: { 'idempotency-key': randomUUID() } }), params({ gameId: 'dice' }));
      statuses.push(res.status);
      if (res.status === 429) {
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        break;
      }
    }
    expect(statuses).toContain(429);
  });
});

describe('API: operations endpoints', () => {
  it('readiness reports ok and metrics require a bearer token', async () => {
    const ready = await healthRoute();
    expect(ready.status).toBe(200);
    expect((await ready.json()).status).toBe('ok');
    const metrics = metricsRoute(req('/api/metrics'));
    expect(metrics.status).toBe(403);
  });
});

describe('API: metrics endpoint policy (optional, fails closed)', () => {
  const withToken = async (value: string | undefined, fn: () => Promise<void> | void) => {
    const saved = process.env.METRICS_TOKEN;
    if (value === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = value;
    resetEnvCache();
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = saved;
      resetEnvCache();
    }
  };
  const probes = [undefined, 'Bearer ', 'Bearer', 'Bearer undefined', 'Bearer null', 'Bearer    '];
  const call = (authorization?: string) => metricsRoute(req('/api/metrics', { headers: authorization === undefined ? {} : { authorization } }));

  it.each([
    ['unset', undefined],
    ['empty (as Docker Compose passes an unset variable)', ''],
    ['whitespace only', '    '],
  ])('token %s: disabled — every request is refused', async (_label, value) => {
    await withToken(value, () => {
      for (const p of probes) expect(call(p).status, `authorization=${JSON.stringify(p)}`).toBe(403);
    });
  });

  it('token set: only the exact bearer token is accepted', async () => {
    const token = 'm'.repeat(12) + 'X9_-.~+/=' + 'k'.repeat(10);
    await withToken(token, async () => {
      for (const p of [...probes, `Bearer ${token}x`, `bearer ${token}`, `Basic ${token}`, token]) {
        expect(call(p).status, `authorization=${JSON.stringify(p)}`).toBe(403);
      }
      const ok = call(`Bearer ${token}`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toContain('text/plain');
      expect(await ok.text()).toContain('process_uptime_seconds');
    });
  });
});

