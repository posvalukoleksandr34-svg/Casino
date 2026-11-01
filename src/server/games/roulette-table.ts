/**
 * Automatic roulette table — spectator ("table") spins.
 *
 * A table spin is a public, server-generated roulette result that the wheel
 * shows when a player did not bet. It is not a wager: this module never
 * touches users, wallets, rounds or the ledger, and has nothing to settle.
 *
 * Results come from a per-day server seed (32 random bytes from the CSPRNG,
 * stored encrypted like player seeds) whose SHA-256 commitment is published
 * in advance; a slot's result is revealed only after its betting window has
 * closed, and the day's seed only after the day has ended.
 */
import { desc, eq, inArray } from 'drizzle-orm';
import { hashServerSeed } from '@/engine/rng/provably-fair';
import { pocketColor } from '@/engine/games/roulette';
import { slotAt, slotDay, slotTimes, tableSpinResult, TABLE_BETTING_MS, TABLE_CLIENT_SEED, TABLE_CYCLE_MS, TABLE_EPOCH_MS, TABLE_RESULT_MS, TABLE_SPIN_MS } from '@/engine/games/roulette/table';
import { decryptSecret, encryptSecret, randomHex } from '../crypto';
import { getDb } from '../db/client';
import { rouletteTableDays, rouletteTableSpins } from '../db/schema';
import { AppError, errors } from '../errors';

/** Clock-skew tolerance: a reveal this early before the close is answered "not yet". */
export const REVEAL_TOLERANCE_MS = 0;
/** Results are revealed (and recorded) only for spins that closed within this window. */
export const REVEAL_WINDOW_MS = 10 * 60_000;

export interface TableSpinView {
  slot: number;
  result: number;
  color: 'red' | 'black' | 'green';
  closedAt: string;
  day: string;
  serverSeedHash: string;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The day's seed row, created (once, race-safely) if missing. */
async function daySeed(day: string): Promise<{ seed: string; hash: string }> {
  const db = getDb();
  const seed = randomHex(32);
  await db.insert(rouletteTableDays).values({ day, serverSeedEnc: encryptSecret(seed), serverSeedHash: hashServerSeed(seed) }).onConflictDoNothing();
  const [row] = await db.select().from(rouletteTableDays).where(eq(rouletteTableDays.day, day));
  if (!row) throw new Error(`table seed for ${day} missing`);
  return { seed: decryptSecret(row.serverSeedEnc), hash: row.serverSeedHash };
}

/** An existing day seed, or null: a spin is only ever revealed from a seed committed beforehand. */
async function committedSeed(day: string): Promise<{ seed: string; hash: string } | null> {
  const [row] = await getDb().select().from(rouletteTableDays).where(eq(rouletteTableDays.day, day));
  return row ? { seed: decryptSecret(row.serverSeedEnc), hash: row.serverSeedHash } : null;
}

/** Commits today's and tomorrow's seeds (so every spin's commitment is public before it closes). */
export async function ensureCommitments(now = Date.now()): Promise<{ day: string; serverSeedHash: string }[]> {
  const days = [dayOf(now), dayOf(now + 86_400_000)];
  const out = [];
  for (const day of days) out.push({ day, serverSeedHash: (await daySeed(day)).hash });
  return out;
}

const view = (slot: number, result: number, day: string, hash: string): TableSpinView => ({
  slot,
  result,
  color: pocketColor(result),
  closedAt: new Date(slotTimes(slot).closesAt).toISOString(),
  day,
  serverSeedHash: hash,
});

/**
 * Reveals a closed table spin and records it in the public history (once).
 * Refuses spins whose betting has not closed yet, and spins too old to have
 * been watched (their results are only available from the recorded history).
 */
export async function revealTableSpin(slot: number, now = Date.now()): Promise<TableSpinView> {
  if (!Number.isSafeInteger(slot) || slot < 0) throw errors.validation('Invalid spin');
  const t = slotTimes(slot);
  if (now < t.closesAt - REVEAL_TOLERANCE_MS) {
    throw new AppError('CONFLICT', 'Betting for this spin has not closed yet', { retryAfterMs: t.closesAt - now });
  }
  const db = getDb();
  const day = slotDay(slot);
  const [recorded] = await db.select().from(rouletteTableSpins).where(eq(rouletteTableSpins.slot, slot));
  if (recorded) {
    const [d] = await db.select({ hash: rouletteTableDays.serverSeedHash }).from(rouletteTableDays).where(eq(rouletteTableDays.day, recorded.day));
    return view(slot, recorded.result, recorded.day, d!.hash);
  }
  if (now - t.closesAt > REVEAL_WINDOW_MS) throw errors.notFound('Table spin');
  const committed = await committedSeed(day);
  if (!committed) throw errors.notFound('Table spin commitment');
  const { seed, hash } = committed;
  const result = tableSpinResult(seed, slot);
  await db.insert(rouletteTableSpins).values({ slot, day, result, closedAt: new Date(t.closesAt) }).onConflictDoNothing();
  return view(slot, result, day, hash);
}

/** The latest recorded table spins, newest first. */
export async function recentTableSpins(limit = 20): Promise<TableSpinView[]> {
  const db = getDb();
  const rows = await db.select().from(rouletteTableSpins).orderBy(desc(rouletteTableSpins.slot)).limit(Math.min(Math.max(limit, 1), 100));
  const days = [...new Set(rows.map((r) => r.day))];
  const hashes = new Map((days.length ? await db.select().from(rouletteTableDays).where(inArray(rouletteTableDays.day, days)) : []).map((d) => [d.day, d.serverSeedHash]));
  return rows.map((r) => view(r.slot, r.result, r.day, hashes.get(r.day)!));
}

/** The schedule, the current slot, today's commitment and the recent history. */
export async function tableState(now = Date.now()) {
  const commitments = await ensureCommitments(now);
  const current = slotAt(now);
  return {
    serverNow: new Date(now).toISOString(),
    schedule: { epoch: TABLE_EPOCH_MS, bettingMs: TABLE_BETTING_MS, spinMs: TABLE_SPIN_MS, resultMs: TABLE_RESULT_MS, cycleMs: TABLE_CYCLE_MS, clientSeed: TABLE_CLIENT_SEED },
    current,
    commitments,
    recent: await recentTableSpins(20),
  };
}

/** A day's commitment; the seed itself only once the day has ended (UTC). */
export async function tableDay(day: string, now = Date.now()) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
  // Round-trip check: rejects impossible dates such as 2030-02-31 (which Date would roll over).
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw errors.validation('Invalid day');
  const [row] = await getDb().select().from(rouletteTableDays).where(eq(rouletteTableDays.day, day));
  if (!row) throw errors.notFound('Table day');
  const ended = day < dayOf(now);
  return { day, serverSeedHash: row.serverSeedHash, serverSeed: ended ? decryptSecret(row.serverSeedEnc) : null, clientSeed: TABLE_CLIENT_SEED };
}
