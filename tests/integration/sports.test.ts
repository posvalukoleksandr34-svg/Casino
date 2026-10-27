import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { POST as placeRoute } from '@/app/api/sports/tickets/route';
import { GET as eventsRoute } from '@/app/api/sports/events/route';
import { PUT as favRoute } from '@/app/api/sports/favorites/[kind]/[refId]/route';
import { POST as adminEventRoute } from '@/app/api/admin/sports/events/[eventId]/route';
import { demoClientSeed, drawScore, outcomeOf, potentialReturn, type ScoreModel } from '@/engine/sports/model';
import { createRandomStream } from '@/engine/rng/provably-fair';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { getDb, getPool, withTransaction } from '@/server/db/client';
import { runChecksWith } from '@/server/jobs/reconciliation';
import {
  ledgerTransactions,
  sportsEvents,
  sportsMarkets,
  sportsSettlements,
  sportsTickets,
  users,
} from '@/server/db/schema';
import { resetEnvCache } from '@/server/env';
import { AppError } from '@/server/errors';
import { getWalletAccount } from '@/server/ledger/accounts';
import { updateLimits } from '@/server/responsible/limits';
import { startRound } from '@/server/games/round-service';
import { adminCorrectResult, adminSuspendEvent, adminVoidEvent, getEvent, listEvents } from '@/server/sports/queries';
import { settleEventTickets } from '@/server/sports/settlement';
import { applyFixtures, applyOdds, ensureDemoFixtures, settleDueDemoEvents } from '@/server/sports/sync';
import { placeSlip, sportsStats } from '@/server/sports/tickets';
import { expectLedgerConsistent, key, newPlayer, setPlatform } from './helpers';

const BASE = 'http://localhost:3000';
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));
const balance = async (userId: string) => (await getWalletAccount(getDb(), userId))!.balance;
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
function req(path: string, opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = `${SESSION_COOKIE_DEV}=${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.method && opts.method !== 'GET') headers.origin = BASE;
  return new NextRequest(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

interface Pick3 {
  eventId: string;
  kickoffAt: Date;
  selections: { id: number; code: 'HOME' | 'DRAW' | 'AWAY'; oddsE2: number }[];
}

/** Open demo events (kick-off in the future), soonest first. */
async function openEvents(n: number): Promise<Pick3[]> {
  const { upcoming } = await listEvents();
  const open = upcoming.filter((e) => e.open && e.market).slice(0, n);
  expect(open.length).toBe(n);
  return open.map((e) => ({
    eventId: e.id,
    kickoffAt: new Date(e.kickoffAt),
    selections: e.market!.selections.map((s) => ({ id: s.id, code: s.code, oddsE2: s.oddsE2! })),
  }));
}

/** Moves an event's kick-off into the past so it can be settled now. */
async function kickOffNow(eventId: string, minutesAgo = 15) {
  await getDb().update(sportsEvents).set({ kickoffAt: new Date(Date.now() - minutesAgo * 60_000) }).where(eq(sportsEvents.id, eventId));
  await getDb().update(sportsMarkets).set({ status: 'CLOSED' }).where(eq(sportsMarkets.eventId, eventId));
}

beforeAll(async () => {
  await ensureDemoFixtures(new Date());
});

afterEach(async () => {
  await setPlatform({ newRoundsEnabled: true, minHouseReserve: 100_000_000 * 100 });
});

describe('demo fixtures', () => {
  it('a rolling schedule of fictional, committed fixtures is created once', async () => {
    expect(await ensureDemoFixtures(new Date())).toBe(0);
    const { upcoming } = await listEvents();
    expect(upcoming.length).toBeGreaterThan(50);
    for (const e of upcoming.slice(0, 10)) {
      expect(e.isDemo).toBe(true);
      expect(e.fairness!.seedHash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.fairness!.revealedSeed).toBeNull();
      expect(e.market!.selections.map((s) => s.code)).toEqual(['HOME', 'DRAW', 'AWAY']);
      expect(e.competition.name).toMatch(/^Demo /);
    }
    const detail = await getEvent(upcoming[0]!.id);
    expect(detail.fairness!.model!.weights).toHaveLength(100);
  });
});

describe('placing predictions', () => {
  it('debits stakes through the ledger, prices from the server and replays idempotently', async () => {
    const p = await newPlayer('sp');
    const [a, b] = await openEvents(2);
    const before = await balance(p.userId);
    const k = key();
    const slip = {
      selections: [
        { selectionId: a!.selections[0]!.id, stake: 1_000, oddsE2: a!.selections[0]!.oddsE2 },
        { selectionId: b!.selections[1]!.id, stake: 500, oddsE2: b!.selections[1]!.oddsE2 },
      ],
    };
    const res = await placeSlip({ userId: p.userId, idempotencyKey: k, slip });
    expect(res.status).toBe(201);
    expect(res.body.tickets.map((t) => t.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(res.body.tickets[0]!.potentialReturn).toBe(potentialReturn(1_000, a!.selections[0]!.oddsE2));
    expect(res.body.balance).toBe(before - 1_500);
    expect(await balance(p.userId)).toBe(before - 1_500);
    const replay = await placeSlip({ userId: p.userId, idempotencyKey: k, slip });
    expect(replay.replayed).toBe(true);
    expect(replay.body.slipId).toBe(res.body.slipId);
    expect(await balance(p.userId)).toBe(before - 1_500);
    await expect(placeSlip({ userId: p.userId, idempotencyKey: k, slip: { ...slip, acceptOddsChanges: true } })).rejects.toSatisfy((e) => code(e) === 'IDEMPOTENCY_CONFLICT');
    await expectLedgerConsistent();
  });

  it('a changed price rejects the ticket (no money moves) unless the player accepts changes; client odds never set the price', async () => {
    const p = await newPlayer('spodds');
    const [e] = await openEvents(1);
    const sel = e!.selections[2]!;
    const before = await balance(p.userId);
    const stale = { selections: [{ selectionId: sel.id, stake: 1_000, oddsE2: sel.oddsE2 + 50 }] };
    const r1 = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: stale });
    expect(r1.body.tickets[0]!.status).toBe('REJECTED');
    expect(r1.body.tickets[0]!.rejectReason).toMatch(/Odds changed from/);
    expect(await balance(p.userId)).toBe(before);
    const r2 = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { ...stale, acceptOddsChanges: true } });
    expect(r2.body.tickets[0]!.status).toBe('ACCEPTED');
    expect(r2.body.tickets[0]!.oddsE2).toBe(sel.oddsE2); // the server's price, not the client's
    expect(r2.body.tickets[0]!.potentialReturn).toBe(potentialReturn(1_000, sel.oddsE2));
    await expectLedgerConsistent();
  });

  it('refuses malformed slips, unknown selections and limit breaches without creating tickets', async () => {
    const p = await newPlayer('spbad');
    const [e] = await openEvents(1);
    const s = e!.selections[0]!;
    const bad = [
      { selections: [] },
      { selections: [{ selectionId: s.id, stake: 5, oddsE2: s.oddsE2 }] },
      { selections: [{ selectionId: s.id, stake: 100.5, oddsE2: s.oddsE2 }] },
      { selections: [{ selectionId: s.id, stake: 100, oddsE2: s.oddsE2 }, { selectionId: s.id, stake: 100, oddsE2: s.oddsE2 }] },
      { selections: [{ selectionId: s.id, stake: 100, oddsE2: s.oddsE2, payout: 1e9 }] },
    ];
    for (const slip of bad) await expect(placeSlip({ userId: p.userId, idempotencyKey: key(), slip })).rejects.toSatisfy((x) => code(x) === 'VALIDATION_ERROR');
    await expect(placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: 999_999_999, stake: 100, oddsE2: 200 }] } })).rejects.toSatisfy(
      (x) => code(x) === 'NOT_FOUND',
    );
    const n = await getDb().select({ n: sql<number>`count(*)::int` }).from(sportsTickets).where(eq(sportsTickets.userId, p.userId));
    expect(n[0]!.n).toBe(0);
  });

  it('enforces the kill switch, the house reserve, responsible-play limits and suspended markets', async () => {
    const p = await newPlayer('spguard');
    const [e] = await openEvents(1);
    const s = e!.selections[0]!;
    const slip = (stake = 1_000) => ({ selections: [{ selectionId: s.id, stake, oddsE2: s.oddsE2 }] });

    await setPlatform({ newRoundsEnabled: false });
    await expect(placeSlip({ userId: p.userId, idempotencyKey: key(), slip: slip() })).rejects.toSatisfy((x) => code(x) === 'GAME_UNAVAILABLE');
    await setPlatform({ newRoundsEnabled: true, minHouseReserve: 10_000_000_000 * 100 });
    await expect(placeSlip({ userId: p.userId, idempotencyKey: key(), slip: slip() })).rejects.toSatisfy((x) => code(x) === 'RISK_LIMIT');
    await setPlatform({ minHouseReserve: 100_000_000 * 100 });

    // Sports stakes count toward the same wagering limit as casino rounds.
    await withTransaction((tx) => updateLimits(tx, p.userId, { dailyWagerLimit: 1_500 }));
    await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: slip(1_000) });
    await expect(placeSlip({ userId: p.userId, idempotencyKey: key(), slip: slip(1_000) })).rejects.toSatisfy((x) => code(x) === 'RESPONSIBLE_GAMING');
    await expect(startRound({ userId: p.userId, gameId: 'dice', bet: { amount: 600, target: 5000, direction: 'under' }, idempotencyKey: key() })).rejects.toSatisfy(
      (x) => code(x) === 'RESPONSIBLE_GAMING',
    );

    const q = await newPlayer('spsusp');
    const adm = await newPlayer('spadm');
    await adminSuspendEvent({ adminId: adm.userId }, e!.eventId, true, 'Operator check on this fixture');
    const r = await placeSlip({ userId: q.userId, idempotencyKey: key(), slip: slip() });
    expect(r.body.tickets[0]!.rejectReason).toBe('Market suspended');
    const [ticket] = await getDb().select().from(sportsTickets).where(and(eq(sportsTickets.userId, p.userId), eq(sportsTickets.status, 'SUSPENDED')));
    expect(ticket).toBeDefined();
    await adminSuspendEvent({ adminId: adm.userId }, e!.eventId, false, 'Operator check finished');
    const [resumed] = await getDb().select().from(sportsTickets).where(eq(sportsTickets.id, ticket!.id));
    expect(resumed!.status).toBe('ACCEPTED');
    await expectLedgerConsistent();
  });

  it('a started event takes no predictions', async () => {
    const p = await newPlayer('spstarted');
    const [e] = await openEvents(1);
    await kickOffNow(e!.eventId, 1);
    const r = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: e!.selections[0]!.id, stake: 100, oddsE2: e!.selections[0]!.oddsE2 }] } });
    expect(r.body.tickets[0]!.status).toBe('REJECTED');
    expect(r.body.tickets[0]!.rejectReason).toMatch(/Market closed|started/);
  });
});

describe('settlement', () => {
  it('draws the demo result from the committed seed, pays exactly once and reveals the seed', async () => {
    const p = await newPlayer('spsettle');
    const [e] = await openEvents(1);
    const before = await balance(p.userId);
    const slip = { selections: e!.selections.map((s) => ({ selectionId: s.id, stake: 1_000, oddsE2: s.oddsE2 })) };
    // Three single predictions on the same event: one per outcome.
    await placeSlip({ userId: p.userId, idempotencyKey: key(), slip });
    await kickOffNow(e!.eventId);
    expect(await settleDueDemoEvents(new Date())).toBeGreaterThanOrEqual(1);
    const ev = await getEvent(e!.eventId);
    expect(ev.status).toBe('FINISHED');
    const seed = ev.fairness!.revealedSeed!;
    expect(createHash('sha256').update(seed).digest('hex')).toBe(ev.fairness!.seedHash);
    const recomputed = drawScore(ev.fairness!.model as ScoreModel, createRandomStream({ serverSeed: seed, clientSeed: demoClientSeed(ev.id), nonce: 0 }));
    expect(recomputed).toEqual(ev.score);
    const winner = outcomeOf(ev.score!.home, ev.score!.away);
    const tickets = await getDb().select().from(sportsTickets).where(eq(sportsTickets.userId, p.userId));
    for (const t of tickets) {
      expect(t.status).toBe(t.selectionCode === winner ? 'WON' : 'LOST');
      expect(t.payout).toBe(t.selectionCode === winner ? t.potentialReturn : 0);
    }
    const won = tickets.find((t) => t.status === 'WON')!;
    expect(await balance(p.userId)).toBe(before - 3_000 + won.potentialReturn);
    // Re-running settlement changes nothing.
    expect(await settleEventTickets(e!.eventId)).toBe(0);
    expect(await settleDueDemoEvents(new Date())).toBe(0);
    expect(await balance(p.userId)).toBe(before - 3_000 + won.potentialReturn);
    const stats = await sportsStats(p.userId);
    expect(stats).toMatchObject({ won: 1, lost: 2, staked: 3_000, returned: won.potentialReturn, net: won.potentialReturn - 3_000 });
    await expectLedgerConsistent();
  });

  it('a void refunds each stake exactly once', async () => {
    const p = await newPlayer('spvoid');
    const adm = await newPlayer('spvoidadm');
    const [e] = await openEvents(1);
    const before = await balance(p.userId);
    await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: e!.selections[0]!.id, stake: 2_000, oddsE2: e!.selections[0]!.oddsE2 }] } });
    expect(await balance(p.userId)).toBe(before - 2_000);
    const first = await adminVoidEvent({ adminId: adm.userId }, e!.eventId, 'Fixture abandoned in the demo');
    expect(first).toMatchObject({ changed: true, settled: 1 });
    const again = await adminVoidEvent({ adminId: adm.userId }, e!.eventId, 'Fixture abandoned in the demo');
    expect(again).toMatchObject({ changed: false, settled: 0 });
    expect(await settleEventTickets(e!.eventId)).toBe(0);
    expect(await balance(p.userId)).toBe(before);
    const [t] = await getDb().select().from(sportsTickets).where(eq(sportsTickets.userId, p.userId));
    expect(t).toMatchObject({ status: 'VOIDED', payout: 2_000 });
    const refunds = await getDb().select().from(ledgerTransactions).where(and(eq(ledgerTransactions.sportsTicketId, t!.id), eq(ledgerTransactions.type, 'SPORTS_VOIDED')));
    expect(refunds).toHaveLength(1);
    await expectLedgerConsistent();
  });

  it('result corrections only ever credit: lost→won pays the difference, won→lost keeps the payout', async () => {
    const p = await newPlayer('spcorr');
    const adm = await newPlayer('spcorradm');
    const [e] = await openEvents(1);
    const home = e!.selections.find((s) => s.code === 'HOME')!;
    const before = await balance(p.userId);
    await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: home.id, stake: 1_000, oddsE2: home.oddsE2 }] } });
    await kickOffNow(e!.eventId);
    // Operator records 0-1 (home loses), then corrects to 2-1 (home wins), then back to 0-0.
    await adminCorrectResult({ adminId: adm.userId }, e!.eventId, 0, 1, 'Result entered by the operator');
    const [lost] = await getDb().select().from(sportsTickets).where(eq(sportsTickets.userId, p.userId));
    expect(lost).toMatchObject({ status: 'LOST', payout: 0, settlementVersion: 1 });
    expect(await balance(p.userId)).toBe(before - 1_000);

    await adminCorrectResult({ adminId: adm.userId }, e!.eventId, 2, 1, 'Corrected: home side scored twice');
    const [won] = await getDb().select().from(sportsTickets).where(eq(sportsTickets.userId, p.userId));
    expect(won).toMatchObject({ status: 'WON', payout: won!.potentialReturn, settlementVersion: 2 });
    expect(await balance(p.userId)).toBe(before - 1_000 + won!.potentialReturn);

    await adminCorrectResult({ adminId: adm.userId }, e!.eventId, 0, 0, 'Corrected again: goals disallowed');
    const [after] = await getDb().select().from(sportsTickets).where(eq(sportsTickets.userId, p.userId));
    expect(after).toMatchObject({ status: 'LOST', payout: won!.potentialReturn, settlementVersion: 3 });
    expect(await balance(p.userId)).toBe(before - 1_000 + won!.potentialReturn); // no clawback

    const settlements = await getDb().select().from(sportsSettlements).where(eq(sportsSettlements.ticketId, after!.id));
    expect(settlements.map((s) => [s.version, s.outcome, s.credited])).toEqual(
      expect.arrayContaining([
        [1, 'LOST', 0],
        [2, 'WON', won!.potentialReturn],
        [3, 'LOST', 0],
      ]),
    );
    // Repeating the same result is a no-op.
    expect(await adminCorrectResult({ adminId: adm.userId }, e!.eventId, 0, 0, 'Same result again')).toMatchObject({ changed: false });
    await expectLedgerConsistent();
  });
});

describe('reconciliation catches tampering (rolled back)', () => {
  it('a payout edited behind the ledger, or an escrow drained, is flagged', async () => {
    const p = await newPlayer('sptamper');
    const [e] = await openEvents(1);
    await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: e!.selections[0]!.id, stake: 1_000, oddsE2: e!.selections[0]!.oddsE2 }] } });
    await kickOffNow(e!.eventId);
    await settleDueDemoEvents(new Date());
    const [t] = await getDb().select().from(sportsTickets).where(eq(sportsTickets.userId, p.userId));
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      expect((await runChecksWith(client)).filter((c) => c.mismatches > 0)).toEqual([]);
      await client.query('UPDATE sports_tickets SET payout = potential_return, status = $2 WHERE id = $1', [t!.id, 'WON']);
      const flagged = (await runChecksWith(client)).filter((c) => c.mismatches > 0).map((c) => c.name);
      expect(flagged).toEqual(expect.arrayContaining(['sports_ticket_ledger', 'sports_settlements_consistent']));
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query(`UPDATE sports_tickets SET status = 'ACCEPTED', payout = NULL WHERE id = $1`, [t!.id]);
      expect((await runChecksWith(client)).filter((c) => c.mismatches > 0).map((c) => c.name)).toEqual(
        expect.arrayContaining(['sports_escrow_matches_open_tickets']),
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await expectLedgerConsistent();
  });
});

describe('API', () => {
  it('requires a session, a same-origin request and an idempotency key; lists events publicly', async () => {
    const p = await newPlayer('spapi');
    const [e] = await openEvents(1);
    const body = { selections: [{ selectionId: e!.selections[0]!.id, stake: 100, oddsE2: e!.selections[0]!.oddsE2 }] };
    expect((await placeRoute(req('/api/sports/tickets', { method: 'POST', body, headers: { 'idempotency-key': key() } }), params({}))).status).toBe(401);
    expect((await placeRoute(req('/api/sports/tickets', { method: 'POST', body, token: p.token }), params({}))).status).toBe(400);
    const ok = await placeRoute(req('/api/sports/tickets', { method: 'POST', body, token: p.token, headers: { 'idempotency-key': key() } }), params({}));
    expect(ok.status).toBe(201);
    const list = await (await eventsRoute(req('/api/sports/events'), params({}))).json();
    expect(list.mode).toBe('demo');
    expect(list.upcoming.length).toBeGreaterThan(0);
    expect(list.favorites).toBeNull();
    // Favourites validate the reference.
    expect((await favRoute(req('/api/sports/favorites/team/demo-aldmere', { method: 'PUT', token: p.token }), params({ kind: 'team', refId: 'demo-aldmere' }))).status).toBe(200);
    expect((await favRoute(req('/api/sports/favorites/team/nope', { method: 'PUT', token: p.token }), params({ kind: 'team', refId: 'nope' }))).status).toBe(404);
    expect((await favRoute(req('/api/sports/favorites/player/x', { method: 'PUT', token: p.token }), params({ kind: 'player', refId: 'x' }))).status).toBe(404);
  });

  it('operator actions need sports:manage and are audited', async () => {
    const p = await newPlayer('spapiplayer');
    const rm = await newPlayer('spapirm');
    await getDb().update(users).set({ role: 'RISK_MANAGER' }).where(eq(users.id, rm.userId));
    const [e] = await openEvents(1);
    const call = (token: string, body: unknown) => adminEventRoute(req(`/api/admin/sports/events/${e!.eventId}`, { method: 'POST', token, body }), params({ eventId: e!.eventId }));
    expect((await call(p.token, { action: 'suspend', reason: 'Player trying admin action' })).status).toBe(403);
    expect((await call(rm.token, { action: 'result', home: 1, away: 0, reason: 'Too early for a result' })).status).toBe(409);
    expect((await call(rm.token, { action: 'suspend', reason: 'Checking this fixture' })).status).toBe(200);
    expect((await call(rm.token, { action: 'resume', reason: 'Fixture checked' })).status).toBe(200);
    const audited = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM admin_actions WHERE admin_id = ${rm.userId} AND action LIKE 'sports.%'`);
    expect(audited.rows[0]!.n).toBe(2);
  });
});

describe('live providers (synthetic payloads; no network)', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    Object.assign(process.env, { SPORTS_MODE: 'live', FOOTBALL_DATA_API_KEY: 'test-key-not-real', THE_ODDS_API_KEY: 'test-key-not-real' });
    resetEnvCache();
  });
  afterEach(() => undefined);

  it('imports fixtures, maps odds by team names, versions price changes, settles results and voids cancellations', async () => {
    try {
      const now = new Date();
      const kick = new Date(now.getTime() + 2 * 3_600_000);
      const fixture = (id: string, status: 'SCHEDULED' | 'FINISHED' | 'CANCELLED', score: { home: number; away: number } | null = null) => ({
        externalId: id,
        competition: { id: '9001', name: 'Test Competition', country: 'Testland' },
        home: { id: `${id}h`, name: `Northfield ${id} FC`, shortName: null },
        away: { id: `${id}a`, name: `Southmoor ${id}`, shortName: null },
        kickoffAt: kick,
        status,
        score,
        updatedAt: now,
      });
      const fx = `t${Date.now().toString(36)}`;
      await applyFixtures([fixture(`${fx}1`, 'SCHEDULED'), fixture(`${fx}2`, 'SCHEDULED')], 'football-data', now);
      const odds = (id: string, h: number, d: number, a: number) => ({
        externalId: `odds-${id}`,
        homeName: `Northfield ${id}`,
        awayName: `Southmoor ${id}`,
        kickoffAt: kick,
        bookmaker: 'Example Book',
        updatedAt: now,
        odds: { HOME: h, DRAW: d, AWAY: a },
      });
      expect(await applyOdds([odds(`${fx}1`, 210, 330, 360), odds(`${fx}2`, 150, 400, 600), { ...odds('nomatch', 200, 300, 400) }], 'the-odds-api', now)).toEqual({ matched: 2, unmatched: 1 });
      const [ev1] = await getDb().select().from(sportsEvents).where(and(eq(sportsEvents.source, 'football-data'), eq(sportsEvents.externalId, `${fx}1`)));
      const view = await getEvent(ev1!.id);
      expect(view.market!.oddsSource).toBe('Example Book via The Odds API');
      expect(view.market!.selections.map((s) => s.oddsE2)).toEqual([210, 330, 360]);

      // A price change bumps the market version; a slip with the old price is rejected.
      await applyOdds([odds(`${fx}1`, 205, 330, 370)], 'the-odds-api', now);
      const v2 = await getEvent(ev1!.id);
      expect(v2.market!.version).toBe(2);
      const p = await newPlayer('splive');
      const home = v2.market!.selections[0]!;
      const r = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: home.id, stake: 1_000, oddsE2: 210 }] } });
      expect(r.body.tickets[0]!.rejectReason).toBe('Odds changed from 2.10 to 2.05');
      const ok = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: home.id, stake: 1_000, oddsE2: 205 }] } });
      expect(ok.body.tickets[0]!.status).toBe('ACCEPTED');

      // Stale prices pause predictions.
      await getDb().update(sportsMarkets).set({ oddsUpdatedAt: new Date(now.getTime() - 3 * 3_600_000) }).where(eq(sportsMarkets.eventId, ev1!.id));
      const stale = await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: home.id, stake: 1_000, oddsE2: 205 }] } });
      expect(stale.body.tickets[0]!.rejectReason).toBe('Odds are out of date');

      // The provider reports the final score: the accepted ticket settles.
      await applyFixtures([{ ...fixture(`${fx}1`, 'FINISHED', { home: 2, away: 0 }), kickoffAt: new Date(now.getTime() - 3 * 3_600_000) }], 'football-data', now);
      const [t] = await getDb().select().from(sportsTickets).where(and(eq(sportsTickets.userId, p.userId), inArray(sportsTickets.status, ['WON', 'LOST'])));
      expect(t).toMatchObject({ status: 'WON', payout: potentialReturn(1_000, 205), settlementSource: 'football-data' });

      // Cancellation voids the other event's tickets.
      const [ev2] = await getDb().select().from(sportsEvents).where(and(eq(sportsEvents.source, 'football-data'), eq(sportsEvents.externalId, `${fx}2`)));
      const s2 = (await getEvent(ev2!.id)).market!.selections[0]!;
      await placeSlip({ userId: p.userId, idempotencyKey: key(), slip: { selections: [{ selectionId: s2.id, stake: 700, oddsE2: s2.oddsE2! }] } });
      await applyFixtures([fixture(`${fx}2`, 'CANCELLED')], 'football-data', now);
      const [v] = await getDb().select().from(sportsTickets).where(and(eq(sportsTickets.userId, p.userId), eq(sportsTickets.eventId, ev2!.id)));
      expect(v).toMatchObject({ status: 'VOIDED', payout: 700 });
      await expectLedgerConsistent();
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      resetEnvCache();
    }
  });
});
