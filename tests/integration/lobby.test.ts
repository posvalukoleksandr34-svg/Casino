import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET as favoritesRoute } from '@/app/api/favorites/route';
import { DELETE as unfavoriteRoute, PUT as favoriteRoute } from '@/app/api/favorites/[gameId]/route';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { startRound } from '@/server/games/round-service';
import { listGames } from '@/server/games/lobby';
import { listFavorites, recentlyPlayed } from '@/server/games/favorites';
import { key, newPlayer, setGameStatus } from './helpers';

const BASE = 'http://localhost:3000';

function req(path: string, opts: { method?: string; token?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.cookie = `${SESSION_COOKIE_DEV}=${opts.token}`;
  if (opts.method && opts.method !== 'GET') headers.origin = opts.origin ?? BASE;
  return new NextRequest(`${BASE}${path}`, { method: opts.method ?? 'GET', headers });
}
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

describe('lobby catalogue', () => {
  it('lists every registered game with categories and an added-on date', async () => {
    const games = await listGames();
    for (const id of ['roulette', 'dice', 'mines', 'crash', 'blackjack', 'limbo', 'keno', 'plinko', 'hilo']) {
      const g = games.find((x) => x.id === id);
      expect(g, id).toBeDefined();
      expect(g!.categories.length).toBeGreaterThan(0);
      expect(g!.addedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(games.find((g) => g.id === 'roulette')!.isNew).toBe(false);
  });
});

describe('favourites API', () => {
  it('requires a session and a same-origin request', async () => {
    expect((await favoritesRoute(req('/api/favorites'), params({}))).status).toBe(401);
    expect((await favoriteRoute(req('/api/favorites/dice', { method: 'PUT' }), params({ gameId: 'dice' }))).status).toBe(401);
    const p = await newPlayer('favcsrf');
    const cross = await favoriteRoute(req('/api/favorites/dice', { method: 'PUT', token: p.token, origin: 'https://evil.example' }), params({ gameId: 'dice' }));
    expect(cross.status).toBe(403);
    expect(await listFavorites(p.userId)).toEqual([]);
  });

  it('adds and removes idempotently, rejects unknown or disabled games, and is per player', async () => {
    const a = await newPlayer('fava');
    const b = await newPlayer('favb');
    const put = (gameId: string, token = a.token) => favoriteRoute(req(`/api/favorites/${gameId}`, { method: 'PUT', token }), params({ gameId }));
    const del = (gameId: string, token = a.token) => unfavoriteRoute(req(`/api/favorites/${gameId}`, { method: 'DELETE', token }), params({ gameId }));

    expect(await (await put('keno')).json()).toEqual({ favorites: ['keno'] });
    expect(await (await put('keno')).json()).toEqual({ favorites: ['keno'] });
    expect(await (await put('dice')).json()).toEqual({ favorites: ['keno', 'dice'] });
    expect((await put('poker')).status).toBe(404);
    expect((await put('../users')).status).toBe(404);

    await setGameStatus('plinko', 'DISABLED');
    try {
      expect((await put('plinko')).status).toBe(404);
    } finally {
      await setGameStatus('plinko', 'ACTIVE');
    }

    expect(await listFavorites(b.userId)).toEqual([]);
    expect(await (await del('keno', b.token)).json()).toEqual({ favorites: [] });
    expect(await listFavorites(a.userId)).toEqual(['keno', 'dice']);

    expect(await (await del('keno')).json()).toEqual({ favorites: ['dice'] });
    expect(await (await del('keno')).json()).toEqual({ favorites: ['dice'] });
    const list = await (await favoritesRoute(req('/api/favorites', { token: a.token }), params({}))).json();
    expect(list.favorites).toEqual(['dice']);
  });
});

describe('recently played', () => {
  it('derives the list from the player’s own rounds, most recent first', async () => {
    const p = await newPlayer('recent');
    const other = await newPlayer('recentother');
    expect(await recentlyPlayed(p.userId)).toEqual([]);
    await startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 100, target: 5000, direction: 'under' }, idempotencyKey: key() });
    await startRound({ userId: p.userId, gameId: 'limbo', bet: { amount: 100, targetE2: 200 }, idempotencyKey: key() });
    await startRound({ userId: other.userId, gameId: 'keno', bet: { amount: 100, picks: [1] }, idempotencyKey: key() });
    const recent = await recentlyPlayed(p.userId);
    expect(recent.map((r) => r.gameId)).toEqual(['limbo', 'dice']);
    const res = await (await favoritesRoute(req('/api/favorites', { token: p.token }), params({}))).json();
    expect(res.recent.map((r: { gameId: string }) => r.gameId)).toEqual(['limbo', 'dice']);
  });
});
