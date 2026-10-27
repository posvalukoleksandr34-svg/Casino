import { describe, expect, it } from 'vitest';
import { DEMO_COMPETITIONS, DEMO_TEAMS, demoExpectedGoals } from '@/engine/sports/demo-data';
import {
  buildScoreModel,
  correctionCredit,
  DEMO_MARGIN_BP,
  demoPrices,
  drawScore,
  outcomeOf,
  outcomeWeights,
  potentialReturn,
  priceOutcome,
  selectionRtp,
  settleTicket,
  totalWeight,
  validateScoreModel,
} from '@/engine/sports/model';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { footballDataResponse, mapMatches, mapStatus } from '@/server/sports/providers/football-data';
import { fetchJson, oddsToE2, ProviderError } from '@/server/sports/providers/http';
import { mapOdds, oddsApiResponse, theOddsApiProvider } from '@/server/sports/providers/the-odds-api';
import { demoFixtureForSlot, normalizeTeam, sameTeam } from '@/server/sports/sync';
import { z } from 'zod';

describe('demo score model and prices', () => {
  it('every demo pairing is priced below 1 / (1 + margin) and every outcome is offered', () => {
    const bound = 10_000 / (10_000 + DEMO_MARGIN_BP);
    for (const h of DEMO_TEAMS) {
      for (const a of DEMO_TEAMS) {
        if (h.id === a.id) continue;
        const g = demoExpectedGoals(h.id, a.id);
        const m = buildScoreModel(g.homeE3, g.awayE3);
        validateScoreModel(m);
        const w = outcomeWeights(m);
        expect(w.HOME + w.DRAW + w.AWAY).toBe(totalWeight(m));
        const prices = demoPrices(m);
        for (const o of ['HOME', 'DRAW', 'AWAY'] as const) {
          expect(prices[o]).not.toBeNull();
          // Exact integer check: W_o · odds · (10⁴ + margin) ≤ W · 100 · 10⁴
          expect(BigInt(w[o]) * BigInt(prices[o]!) * BigInt(10_000 + DEMO_MARGIN_BP) <= BigInt(totalWeight(m)) * 100n * 10_000n).toBe(true);
          expect(selectionRtp(m, o, prices[o]!)).toBeLessThanOrEqual(bound);
          expect(selectionRtp(m, o, prices[o]!)).toBeGreaterThan(bound - 0.01);
        }
      }
    }
  });

  it('a price below 1.01 is not offered (it could return more than the stake on average)', () => {
    expect(priceOutcome(990_000_000, 1_000_000_000, 600)).toBeNull();
    expect(priceOutcome(0, 1_000_000_000, 600)).toBeNull();
    expect(priceOutcome(500_000_000, 1_000_000_000, 600)).toBe(188); // 2 / 1.06 = 1.886…
  });

  it('the result draw follows the published table (deterministic per seed, chi-square over outcomes)', () => {
    const m = buildScoreModel(1450, 1150);
    const w = outcomeWeights(m);
    const counts = { HOME: 0, DRAW: 0, AWAY: 0 };
    const N = 30_000;
    for (let i = 0; i < N; i += 1) {
      const s = drawScore(m, new HmacRandomStream({ serverSeed: 'ab'.repeat(32), clientSeed: 'sports-demo-test', nonce: i }));
      counts[outcomeOf(s.home, s.away)] += 1;
    }
    const total = totalWeight(m);
    let chi = 0;
    for (const o of ['HOME', 'DRAW', 'AWAY'] as const) {
      const e = (N * w[o]) / total;
      chi += (counts[o] - e) ** 2 / e;
    }
    expect(chi).toBeLessThan(13.8); // χ²(2), α = 0.001
    const a = drawScore(m, new HmacRandomStream({ serverSeed: 'cd'.repeat(32), clientSeed: 'x', nonce: 0 }));
    const b = drawScore(m, new HmacRandomStream({ serverSeed: 'cd'.repeat(32), clientSeed: 'x', nonce: 0 }));
    expect(a).toEqual(b);
  });

  it('refuses malformed models', () => {
    expect(() => buildScoreModel(50, 1000)).toThrow(RangeError);
    expect(() => validateScoreModel({ ...buildScoreModel(1000, 1000), weights: [1, 2, 3] })).toThrow();
    expect(() => validateScoreModel({ ...buildScoreModel(1000, 1000), weights: Array(100).fill(-1) })).toThrow();
  });

  it('demo fixtures are fictional, deterministic per slot and never pair a team with itself', () => {
    const names = DEMO_TEAMS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (let i = 0; i < 500; i += 1) {
      const f = demoFixtureForSlot(new Date(Date.UTC(2026, 9, 27) + i * 20 * 60_000));
      expect(f.homeId).not.toBe(f.awayId);
      const comp = DEMO_COMPETITIONS.find((c) => c.id === f.competitionId)!;
      expect(comp.teams).toContain(f.homeId);
      expect(comp.teams).toContain(f.awayId);
      expect(demoFixtureForSlot(new Date(Date.UTC(2026, 9, 27) + i * 20 * 60_000))).toEqual(f);
    }
  });
});

describe('settlement rules', () => {
  const ticket = { selectionCode: 'HOME' as const, stake: 1_000, potentialReturn: potentialReturn(1_000, 215) };
  it('win pays ⌊stake × odds⌋, loss pays nothing, void returns the stake', () => {
    expect(ticket.potentialReturn).toBe(2_150);
    expect(potentialReturn(333, 101)).toBe(336); // ⌊336.33⌋
    expect(settleTicket(ticket, { kind: 'RESULT', home: 2, away: 1 })).toEqual({ outcome: 'WON', entitlement: 2_150 });
    expect(settleTicket(ticket, { kind: 'RESULT', home: 1, away: 1 })).toEqual({ outcome: 'LOST', entitlement: 0 });
    expect(settleTicket(ticket, { kind: 'VOID' })).toEqual({ outcome: 'VOIDED', entitlement: 1_000 });
  });
  it('corrections credit only the positive difference', () => {
    expect(correctionCredit(0, 2_150)).toBe(2_150);
    expect(correctionCredit(2_150, 0)).toBe(0);
    expect(correctionCredit(1_000, 2_150)).toBe(1_150);
    expect(correctionCredit(2_150, 1_000)).toBe(0);
  });
});

describe('football-data.org adapter', () => {
  const payload = {
    matches: [
      {
        id: 1,
        utcDate: '2026-11-01T15:00:00Z',
        status: 'FINISHED',
        lastUpdated: '2026-11-01T17:10:00Z',
        competition: { id: 2021, name: 'Example League', code: 'EL' },
        area: { name: 'Exampleland' },
        homeTeam: { id: 10, name: 'Alpha FC', shortName: 'Alpha', tla: 'ALP' },
        awayTeam: { id: 11, name: 'Beta FC', shortName: 'Beta', tla: 'BET' },
        score: { duration: 'REGULAR', fullTime: { home: 2, away: 1 } },
      },
      {
        id: 2,
        utcDate: '2026-11-02T15:00:00Z',
        status: 'FINISHED',
        competition: { id: 2021, name: 'Example League' },
        homeTeam: { id: 12, name: 'Gamma' },
        awayTeam: { id: 13, name: 'Delta' },
        score: { duration: 'PENALTY_SHOOTOUT', fullTime: { home: 5, away: 4 }, regularTime: { home: 1, away: 1 } },
      },
      {
        id: 3,
        utcDate: '2026-11-03T15:00:00Z',
        status: 'TIMED',
        competition: { id: 2021, name: 'Example League' },
        homeTeam: { id: 14, name: 'Epsilon' },
        awayTeam: { id: 15, name: 'Zeta' },
        score: { fullTime: { home: null, away: null } },
      },
    ],
  };
  it('maps statuses and settles 1X2 on the regular-time score', () => {
    const fx = mapMatches(footballDataResponse.parse(payload));
    expect(fx[0]).toMatchObject({ externalId: '1', status: 'FINISHED', score: { home: 2, away: 1 }, home: { id: '10', shortName: 'ALP' } });
    expect(fx[1]).toMatchObject({ status: 'FINISHED', score: { home: 1, away: 1 } }); // not the shoot-out total
    expect(fx[2]).toMatchObject({ status: 'SCHEDULED', score: null });
    expect(mapStatus('AWARDED')).toBe('CANCELLED');
    expect(mapStatus('SOMETHING_NEW')).toBe('SUSPENDED');
  });
});

describe('The Odds API adapter', () => {
  const payload = [
    {
      id: 'ev1',
      commence_time: '2026-11-01T15:00:00Z',
      home_team: 'Alpha FC',
      away_team: 'Beta FC',
      bookmakers: [
        { key: 'book_a', title: 'Book A', last_update: '2026-11-01T10:00:00Z', markets: [{ key: 'h2h', outcomes: [{ name: 'Alpha FC', price: 1.9 }, { name: 'Draw', price: 3.4 }, { name: 'Beta FC', price: 4.2 }] }] },
        { key: 'book_b', title: 'Book B', last_update: '2026-11-01T10:05:00Z', markets: [{ key: 'h2h', outcomes: [{ name: 'Alpha FC', price: 1.95 }, { name: 'Beta FC', price: 4.0 }] }] },
      ],
    },
  ];
  it('takes the configured bookmaker and maps home/draw/away; prices are rounded down', () => {
    const [a] = mapOdds(oddsApiResponse.parse(payload));
    expect(a).toMatchObject({ bookmaker: 'Book A', odds: { HOME: 190, DRAW: 340, AWAY: 420 } });
    const [b] = mapOdds(oddsApiResponse.parse(payload), 'book_b');
    expect(b).toMatchObject({ bookmaker: 'Book B', odds: { HOME: 195, DRAW: null, AWAY: 400 } });
    expect(mapOdds(oddsApiResponse.parse(payload), 'missing')).toEqual([]);
    expect(oddsToE2(2.155)).toBe(215);
    expect(oddsToE2(1.0)).toBeNull();
    expect(oddsToE2(Number.NaN)).toBeNull();
  });

  it('never puts the API key in errors, and reports remaining quota', async () => {
    const secret = 'SECRET-KEY-123456';
    let quota: number | null = null;
    const ok = theOddsApiProvider({
      apiKey: secret,
      sports: 'soccer_test',
      regions: 'eu',
      onQuota: (q) => (quota = q),
      fetchImpl: async (url) => {
        expect(String(url)).toContain(`apiKey=${secret}`);
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json', 'x-requests-remaining': '480' } });
      },
    });
    expect((await ok.fetchOdds())[0]!.odds.HOME).toBe(190);
    expect(quota).toBe(480);
    const failing = theOddsApiProvider({ apiKey: secret, sports: 'soccer_test', regions: 'eu', fetchImpl: async () => new Response('nope', { status: 401 }) });
    const err = await failing.fetchOdds().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(String((err as Error).message)).not.toContain(secret);
    expect(String((err as Error).message)).not.toContain('apiKey');
  });
});

describe('provider HTTP helper', () => {
  const schema = z.object({ ok: z.literal(true) });
  const url = new URL('https://provider.example/v1/thing?apiKey=hidden');
  it('retries 5xx and 429, validates the payload and times out', async () => {
    let calls = 0;
    const flaky: typeof fetch = async () => {
      calls += 1;
      return calls < 3 ? new Response('busy', { status: calls === 1 ? 503 : 429, headers: { 'retry-after': '0' } }) : new Response('{"ok":true}', { status: 200 });
    };
    expect((await fetchJson({ provider: 't1', url, schema, fetchImpl: flaky })).data).toEqual({ ok: true });
    expect(calls).toBe(3);
    const bad: typeof fetch = async () => new Response('{"ok":false}', { status: 200 });
    await expect(fetchJson({ provider: 't2', url, schema, fetchImpl: bad })).rejects.toThrow(/unexpected payload from provider.example\/v1\/thing$/);
    const hang: typeof fetch = (_u, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    await expect(fetchJson({ provider: 't3', url, schema, fetchImpl: hang, timeoutMs: 20, retries: 0 })).rejects.toThrow(/timed out calling provider.example\/v1\/thing$/);
  }, 20_000);
});

describe('team-name matching', () => {
  it('normalises club suffixes, accents and punctuation', () => {
    expect(normalizeTeam('Atlético de Madrid')).toBe('atletico madrid');
    expect(sameTeam('Brighton & Hove Albion FC', 'Brighton and Hove Albion')).toBe(true);
    expect(sameTeam('Manchester United FC', 'Manchester City FC')).toBe(false);
    expect(sameTeam('', 'Anything')).toBe(false);
  });
});
