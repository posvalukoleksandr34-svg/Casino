/**
 * Security of the platform endpoints added in the casino-platform pass:
 * authentication, CSRF (same origin), authorisation, ownership, rate limits,
 * and that client-supplied amounts are never trusted.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET as promotionsRoute } from '@/app/api/promotions/route';
import { POST as claimRoute } from '@/app/api/promotions/claim/route';
import { POST as forfeitRoute } from '@/app/api/promotions/forfeit/route';
import { GET as summaryRoute } from '@/app/api/wallet/summary/route';
import { GET as liveRoute } from '@/app/api/live/route';
import { GET as adminListRoute, POST as adminCreateRoute } from '@/app/api/admin/promotions/route';
import { PATCH as adminPatchRoute } from '@/app/api/admin/promotions/[campaignId]/route';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { bonusCampaigns, users } from '@/server/db/schema';
import { getWalletAccount } from '@/server/ledger/accounts';
import { claimBonus } from '@/server/promotions/campaigns';
import { newPlayer } from './helpers';

const BASE = 'http://localhost:3000';
function req(path: string, opts: { method?: string; body?: unknown; token?: string; origin?: string | null; ip?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}), 'x-forwarded-for': opts.ip ?? `10.88.${randomInt(250)}.${randomInt(250)}` };
  if (opts.body !== undefined) headers['content-type'] ??= 'application/json';
  if (opts.token) headers.cookie = `${SESSION_COOKIE_DEV}=${opts.token}`;
  if (opts.method && opts.method !== 'GET' && opts.origin !== null) headers.origin = opts.origin ?? BASE;
  return new NextRequest(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

async function promo(fixed = 10_000) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const [c] = await getDb()
    .insert(bonusCampaigns)
    .values({ slug: `sec-${suffix.toLowerCase()}`, kind: 'PROMO_CODE', code: `S${suffix}`, name: 'Security promo', description: 'For security tests', fixedAmount: fixed, maxBonus: fixed, wageringMultiplier: 1, expiresAfterDays: 7 })
    .returning();
  return c!;
}

describe('platform endpoints: authentication and CSRF', () => {
  it('player endpoints need a session (401)', async () => {
    for (const res of [
      await promotionsRoute(req('/api/promotions'), params({})),
      await summaryRoute(req('/api/wallet/summary'), params({})),
      await claimRoute(req('/api/promotions/claim', { method: 'POST', body: { code: 'ANYCODE1' } }), params({})),
      await forfeitRoute(req('/api/promotions/forfeit', { method: 'POST', body: { claimId: 1 } }), params({})),
    ]) {
      expect(res.status).toBe(401);
    }
  });

  it('cross-site state changes are refused before anything runs (Origin, Sec-Fetch-Site, JSON only)', async () => {
    const p = await newPlayer('sec-csrf');
    const c = await promo();
    // A foreign Origin, or a browser-marked cross-site request without one.
    const foreign = await claimRoute(req('/api/promotions/claim', { method: 'POST', token: p.token, body: { code: c.code }, origin: 'https://evil.example' }), params({}));
    expect(foreign.status).toBe(403);
    const crossSite = await claimRoute(req('/api/promotions/claim', { method: 'POST', token: p.token, body: { code: c.code }, origin: null, headers: { 'sec-fetch-site': 'cross-site' } }), params({}));
    expect(crossSite.status).toBe(403);
    // An HTML form cannot send JSON: other content types are refused.
    const form = await claimRoute(req('/api/promotions/claim', { method: 'POST', token: p.token, body: { code: c.code }, headers: { 'content-type': 'text/plain' } }), params({}));
    expect(form.status).toBe(400);
    // Nothing was claimed.
    expect((await (await promotionsRoute(req('/api/promotions', { token: p.token }), params({}))).json()).claims).toHaveLength(0);
  });

  it('the live feed is public and read-only', async () => {
    const res = await liveRoute(req('/api/live?once=1'), params({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['at', 'online', 'table', 'wins']);
  });
});

describe('platform endpoints: authorisation, ownership and trust', () => {
  it('players and specialists cannot manage campaigns; admins can', async () => {
    const p = await newPlayer('sec-player');
    const support = await newPlayer('sec-support');
    await getDb().update(users).set({ role: 'SUPPORT' }).where(eq(users.id, support.userId));
    const body = { campaign: { slug: `sec-x-${Date.now()}`, kind: 'PROMO_CODE', code: `X${Date.now().toString(36).toUpperCase()}`.slice(0, 20), name: 'Nope', description: 'Nope', matchPercent: 0, fixedAmount: 100, maxBonus: 100, wageringMultiplier: 0, expiresAfterDays: 1 }, reason: 'Should be refused' };
    expect((await adminListRoute(req('/api/admin/promotions', { token: p.token }), params({}))).status).toBe(403);
    expect((await adminCreateRoute(req('/api/admin/promotions', { method: 'POST', token: p.token, body }), params({}))).status).toBe(403);
    // SUPPORT may view (admin:access) but not create or edit.
    expect((await adminListRoute(req('/api/admin/promotions', { token: support.token }), params({}))).status).toBe(200);
    expect((await adminCreateRoute(req('/api/admin/promotions', { method: 'POST', token: support.token, body }), params({}))).status).toBe(403);
    expect((await adminPatchRoute(req('/api/admin/promotions/1', { method: 'PATCH', token: support.token, body: { patch: { active: false }, reason: 'Should be refused' } }), params({ campaignId: '1' }))).status).toBe(403);
  });

  it("a player cannot forfeit another player's bonus", async () => {
    const owner = await newPlayer('sec-owner');
    const other = await newPlayer('sec-other');
    const c = await promo();
    const claimed = await claimBonus(owner.userId, { code: c.code! });
    const res = await forfeitRoute(req('/api/promotions/forfeit', { method: 'POST', token: other.token, body: { claimId: claimed.claimId } }), params({}));
    expect(res.status).toBe(409);
    const mine = await (await promotionsRoute(req('/api/promotions', { token: owner.token }), params({}))).json();
    expect(mine.active.id).toBe(claimed.claimId);
  });

  it('client-sent amounts are rejected: the server decides the bonus', async () => {
    const p = await newPlayer('sec-amount');
    const c = await promo(10_000);
    const before = (await getWalletAccount(getDb(), p.userId))!.balance;
    const bad = await claimRoute(req('/api/promotions/claim', { method: 'POST', token: p.token, body: { code: c.code, amount: 99_999_999 } }), params({}));
    expect(bad.status).toBe(400);
    const ok = await claimRoute(req('/api/promotions/claim', { method: 'POST', token: p.token, body: { code: c.code } }), params({}));
    expect(ok.status).toBe(200);
    expect((await ok.json()).amount).toBe(10_000);
    // Locked, not spendable: the wallet is unchanged.
    expect((await getWalletAccount(getDb(), p.userId))!.balance).toBe(before);
    const summary = await (await summaryRoute(req('/api/wallet/summary', { token: p.token }), params({}))).json();
    expect(summary.lockedBonus).toBe(10_000);
  });

  it('guessing promo codes is rate-limited per player', async () => {
    const p = await newPlayer('sec-guess');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await claimRoute(req('/api/promotions/claim', { method: 'POST', token: p.token, body: { code: `GUESS${i}X` } }), params({}));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
  });
});
