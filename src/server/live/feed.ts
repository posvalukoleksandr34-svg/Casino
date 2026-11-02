/**
 * The public live feed: players online, recent notable wins and the latest
 * automatic-roulette spin. Read-only aggregates; no round ids, balances or
 * account details. A player's name appears only if they opted in
 * (preferences.publicName); otherwise "A player".
 *
 * One snapshot is shared by every viewer and recomputed at most every few
 * seconds, so the number of open streams does not multiply database load.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';

export interface LiveWin {
  gameId: string;
  game: string;
  player: string;
  /** Payout as a multiple of the stake, hundredths. */
  multiplierE2: number;
  payout: number;
  at: string;
}

export interface LiveSnapshot {
  at: string;
  online: number;
  wins: LiveWin[];
  table: { slot: number; result: number; color: string } | null;
}

/** Wins of at least this multiple of the stake are "notable". */
export const NOTABLE_MULTIPLE = 5;
const TTL_MS = 4_000;
let cache: { at: number; value: LiveSnapshot } | null = null;
let inflight: Promise<LiveSnapshot> | null = null;

async function compute(): Promise<LiveSnapshot> {
  const db = getDb();
  const [online, wins, spin] = await Promise.all([
    db.execute<{ n: string }>(sql`
      SELECT count(DISTINCT user_id)::text AS n FROM sessions
      WHERE revoked_at IS NULL AND expires_at > now() AND last_seen_at > now() - interval '5 minutes'`),
    db.execute<{ game_id: string; game: string; stake: string; payout: string; settled_at: Date; name: string | null; public: boolean | null }>(sql`
      SELECT r.game_id, g.name AS game, r.stake_total::text AS stake, r.payout_total::text AS payout, r.settled_at,
             coalesce(u.display_name, u.username) AS name, (u.preferences->>'publicName')::boolean AS public
      FROM game_rounds r JOIN users u ON u.id = r.user_id JOIN games g ON g.id = r.game_id
      WHERE r.status = 'SETTLED' AND r.settled_at > now() - interval '24 hours'
        AND r.payout_total >= r.stake_total * ${NOTABLE_MULTIPLE} AND r.payout_total > 0
      ORDER BY r.settled_at DESC LIMIT 12`),
    db.execute<{ slot: string; result: number }>(sql`SELECT slot::text, result FROM roulette_table_spins ORDER BY slot DESC LIMIT 1`).catch(() => ({ rows: [] })),
  ]);
  const red = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const s = spin.rows[0];
  return {
    at: new Date().toISOString(),
    online: Number(online.rows[0]?.n ?? 0),
    wins: wins.rows.map((w) => ({
      gameId: w.game_id,
      game: w.game,
      player: w.public ? (w.name ?? 'A player') : 'A player',
      multiplierE2: Math.floor((Number(w.payout) * 100) / Number(w.stake)),
      payout: Number(w.payout),
      at: new Date(w.settled_at).toISOString(),
    })),
    table: s ? { slot: Number(s.slot), result: s.result, color: s.result === 0 ? 'green' : red.has(s.result) ? 'red' : 'black' } : null,
  };
}

/** The current snapshot (cached for a few seconds; concurrent callers share one query). */
export async function liveSnapshot(now = Date.now()): Promise<LiveSnapshot> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  inflight ??= compute()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Open live streams in this process (bounded; see the route). */
export const liveStreams = { open: 0, max: 500 };
