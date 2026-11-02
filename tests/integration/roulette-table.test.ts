/**
 * Automatic roulette table: spectator ("table") spins are server-generated,
 * committed in advance, revealed only after betting closes, recorded once in
 * a separate public history, and never touch rounds, bets, the ledger or any
 * balance. A real wager on the same table still settles as an ordinary round.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET as tableRoute } from '@/app/api/roulette/table/route';
import { GET as spinRoute } from '@/app/api/roulette/table/spins/[slot]/route';
import { GET as dayRoute } from '@/app/api/roulette/table/days/[day]/route';
import { POST as startRoundRoute } from '@/app/api/games/[gameId]/rounds/route';
import { slotAt, slotDay, slotTimes, tableSpinResult, TABLE_BETTING_MS, TABLE_CYCLE_MS } from '@/engine/games/roulette/table';
import { hashServerSeed, verifyCommitment } from '@/engine/rng/provably-fair';
import { SESSION_COOKIE_DEV } from '@/server/auth/sessions';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import { rouletteTableDays } from '@/server/db/schema';
import { getDb } from '@/server/db/client';
import { ensureCommitments, recentTableSpins, revealTableSpin, tableDay, whenMigrated, REVEAL_WINDOW_MS } from '@/server/games/roulette-table';
import { newPlayer } from './helpers';

const BASE = 'http://localhost:3000';
const req = (path: string, token?: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE_DEV}=${token}` } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json', origin: BASE } : {}),
      // Each test client gets its own address so the public per-IP limit is not shared between tests.
      'x-forwarded-for': `10.77.${randomInt(250)}.${randomInt(250)}`,
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

async function counts() {
  const r = await getDb().execute<{ rounds: string; bets: string; entries: string; balances: string; spins: string }>(sql`
    SELECT (SELECT count(*) FROM game_rounds) AS rounds,
           (SELECT count(*) FROM bets) AS bets,
           (SELECT count(*) FROM ledger_entries) AS entries,
           (SELECT coalesce(sum(balance), 0) FROM ledger_accounts) AS balances,
           (SELECT count(*) FROM roulette_table_spins) AS spins`);
  return r.rows[0]!;
}

/** A slot that closed `agoMs` before "now", with now chosen so its day is committed. */
function closedSlot(agoMs = 1000) {
  const now = Date.now();
  const slot = slotAt(now - TABLE_BETTING_MS - agoMs).slot;
  return { slot, now: Math.max(now, slotTimes(slot).closesAt + agoMs) };
}

describe('automatic roulette table: spectator spins', () => {
  // A running server commits each day's seed a day ahead (tomorrow's commitment is
  // published with today's). The test database is new, so commit today's seed as if
  // that had happened: created before today began. Inserts only (the table is append-only).
  beforeAll(async () => {
    const startOfToday = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const seed = randomBytes(32).toString('hex');
    await getDb().insert(rouletteTableDays).values({
      day: startOfToday.toISOString().slice(0, 10),
      serverSeedEnc: encryptSecret(seed),
      serverSeedHash: hashServerSeed(seed),
      createdAt: new Date(startOfToday.getTime() - 3_600_000),
    }).onConflictDoNothing();
  });

  it('publishes today and tomorrow as commitments before any spin closes', async () => {
    const c = await ensureCommitments();
    expect(c).toHaveLength(2);
    for (const d of c) expect(d.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
    // Idempotent: the same commitment every time (append-only, never replaced).
    expect(await ensureCommitments()).toEqual(c);
  });

  it('refuses to reveal a spin before its betting window closes', async () => {
    await ensureCommitments();
    const now = Date.now();
    const open = slotAt(now);
    const res = await revealTableSpin(open.slot + 1, now).catch((e) => e);
    expect(res.code).toBe('CONFLICT');
    expect(res.details.retryAfterMs).toBeGreaterThan(0);
  });

  it('reveals a closed spin from the committed day seed, verifiably, and records it once', async () => {
    await ensureCommitments();
    const { slot, now } = closedSlot(1500);
    const before = await counts();
    const [a, b, c] = await Promise.all([revealTableSpin(slot, now), revealTableSpin(slot, now), revealTableSpin(slot, now + 5000)]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    const day = await getDb().execute<{ server_seed_enc: string; server_seed_hash: string }>(sql`SELECT * FROM roulette_table_days WHERE day = ${slotDay(slot)}`);
    const seed = decryptSecret(day.rows[0]!.server_seed_enc);
    expect(verifyCommitment(seed, a.serverSeedHash)).toBe(true);
    expect(a.result).toBe(tableSpinResult(seed, slot));
    expect(a.closedAt).toBe(new Date(slotTimes(slot).closesAt).toISOString());
    const after = await counts();
    expect(Number(after.spins)).toBe(Number(before.spins) + 1);
    expect((await recentTableSpins(5)).some((s) => s.slot === slot && s.result === a.result)).toBe(true);
  });

  it('never creates rounds, bets, ledger entries or balance changes', async () => {
    const p = await newPlayer('table');
    await ensureCommitments();
    const before = await counts();
    const balanceBefore = await getDb().execute<{ balance: string }>(sql`SELECT balance FROM ledger_accounts WHERE user_id = ${p.userId}`);
    const now = Date.now();
    const base = slotAt(now).slot;
    // Several closed spins, revealed signed in and anonymously, over HTTP.
    for (let k = 1; k <= 4; k++) {
      const slot = base - k;
      if (slotTimes(slot).closesAt > now) continue;
      for (const token of [p.token, undefined]) {
        const res = await spinRoute(req(`/api/roulette/table/spins/${slot}`, token), params({ slot: String(slot) }));
        expect(res.status).toBe(200);
      }
    }
    const after = await counts();
    expect(after.rounds).toBe(before.rounds);
    expect(after.bets).toBe(before.bets);
    expect(after.entries).toBe(before.entries);
    expect(after.balances).toBe(before.balances);
    const balanceAfter = await getDb().execute<{ balance: string }>(sql`SELECT balance FROM ledger_accounts WHERE user_id = ${p.userId}`);
    expect(balanceAfter.rows).toEqual(balanceBefore.rows);
  });

  it('a real wager on the table still settles as an ordinary round with the player\'s own seeds', async () => {
    const p = await newPlayer('tablebet');
    const before = await counts();
    const res = await startRoundRoute(
      req('/api/games/roulette/rounds', p.token, { method: 'POST', body: { bet: { bets: [{ type: 'red', amount: 500 }] } }, headers: { 'idempotency-key': randomUUID() } }),
      params({ gameId: 'roulette' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.round.status).toBe('SETTLED');
    const after = await counts();
    expect(Number(after.rounds)).toBe(Number(before.rounds) + 1);
    expect(Number(after.entries)).toBeGreaterThan(Number(before.entries));
    expect(after.spins).toBe(before.spins); // a wager is not a table spin
  });

  it('does not reveal unwatched spins long after they closed, or spins without a commitment', async () => {
    await ensureCommitments();
    const now = Date.now();
    const old = slotAt(now - REVEAL_WINDOW_MS - 5 * TABLE_CYCLE_MS).slot;
    expect((await revealTableSpin(old, now).catch((e) => e)).code).toBe('NOT_FOUND');
    // A spin in a day nobody committed to (far future, evaluated "after" its close).
    const future = slotAt(Date.UTC(2031, 5, 1)).slot;
    expect((await revealTableSpin(future, slotTimes(future).closesAt + 1000).catch((e) => e)).code).toBe('NOT_FOUND');
  });

  it('never reveals a spin from a seed committed after its betting closed', async () => {
    // Two past days (this database is new, so they are unused), committed at chosen times.
    const commit = async (day: string, createdAt: number) => {
      const seed = randomBytes(32).toString('hex');
      await getDb().insert(rouletteTableDays).values({ day, serverSeedEnc: encryptSecret(seed), serverSeedHash: hashServerSeed(seed), createdAt: new Date(createdAt) });
    };
    const pastDay = (month: number) => new Date(Date.UTC(2026, month, 1 + randomInt(27))).toISOString().slice(0, 10);

    // Committed an hour before the day began: its spins can be revealed.
    const early = pastDay(1 + randomInt(3)); // February–April
    await commit(early, Date.parse(`${early}T00:00:00Z`) - 3_600_000);
    const s1 = slotAt(Date.parse(`${early}T06:00:00Z`)).slot;
    expect((await revealTableSpin(s1, slotTimes(s1).closesAt + 1000)).slot).toBe(s1);

    // Committed late (first request of the day came after this spin closed): refused.
    const late = pastDay(5 + randomInt(3)); // June–August
    const s2 = slotAt(Date.parse(`${late}T06:00:00Z`)).slot;
    await commit(late, slotTimes(s2).closesAt + 1);
    const before = await counts();
    const refused = await revealTableSpin(s2, slotTimes(s2).closesAt + 2000).catch((e) => e);
    expect(refused.code).toBe('NOT_FOUND');
    expect((await counts()).spins).toBe(before.spins); // nothing recorded
    // A spin that closed after the late commitment is fine.
    const s3 = s2 + 2;
    expect((await revealTableSpin(s3, slotTimes(s3).closesAt + 1000)).slot).toBe(s3);
  });

  it('keeps the public history append-only', async () => {
    await ensureCommitments();
    const { slot, now } = closedSlot(2500);
    await revealTableSpin(slot, now);
    await expect(getDb().execute(sql`UPDATE roulette_table_spins SET result = 0 WHERE slot = ${slot}`)).rejects.toThrow();
    await expect(getDb().execute(sql`DELETE FROM roulette_table_spins WHERE slot = ${slot}`)).rejects.toThrow();
    await expect(getDb().execute(sql`UPDATE roulette_table_days SET server_seed_hash = repeat('0', 64)`)).rejects.toThrow();
  });

  it('reveals a day seed only once the day has ended', async () => {
    const [today] = await ensureCommitments();
    const now = Date.now();
    const current = await tableDay(today!.day, now);
    expect(current.serverSeed).toBeNull();
    const later = await tableDay(today!.day, now + 2 * 86_400_000);
    expect(later.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCommitment(later.serverSeed!, later.serverSeedHash)).toBe(true);
    expect((await tableDay('2030-02-31').catch((e) => e)).code).toBe('VALIDATION_ERROR');
  });

  it('a database that has not been migrated yet gives a clear 503, not an internal error', async () => {
    const missing = Object.assign(new Error('relation "roulette_table_days" does not exist'), { code: '42P01' });
    const wrapped = Object.assign(new Error('Failed query'), { cause: missing });
    for (const err of [missing, wrapped]) {
      const res = await whenMigrated(() => Promise.reject(err)).catch((e) => e);
      expect(res.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.message).toMatch(/db:migrate/);
    }
    const other = await whenMigrated(() => Promise.reject(new Error('boom'))).catch((e) => e);
    expect(other.message).toBe('boom');
  });

  it('HTTP: public schedule and history; validation; "not yet" for an open spin', async () => {
    const res = await tableRoute(req('/api/roulette/table'), params({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedule).toMatchObject({ bettingMs: 15_000, cycleMs: TABLE_CYCLE_MS });
    expect(body.current.closesAt - body.current.startsAt).toBe(15_000);
    expect(body.commitments).toHaveLength(2);
    expect(Array.isArray(body.recent)).toBe(true);
    const next = body.current.slot + 1;
    expect((await spinRoute(req(`/api/roulette/table/spins/${next}`), params({ slot: String(next) }))).status).toBe(409);
    expect((await spinRoute(req('/api/roulette/table/spins/abc'), params({ slot: 'abc' }))).status).toBe(400);
    const day = await dayRoute(req(`/api/roulette/table/days/${body.commitments[0].day}`), params({ day: body.commitments[0].day }));
    expect((await day.json()).serverSeed).toBeNull();
  });
});
