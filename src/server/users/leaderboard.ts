/**
 * Leaderboards. Only players who opted in (preferences.publicName) are
 * listed by name; the viewer always sees their own standing, privately.
 * There is deliberately no "most wagered" or "most played" board: boards
 * rank luck (best multiplier) and level, which caps play per day.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { levelFromXp, xpQuery } from './levels';

const OPTED_IN = sql`(u.preferences->>'publicName')::boolean IS TRUE AND u.status = 'ACTIVE' AND u.role = 'PLAYER'`;

export interface BoardRow {
  rank: number;
  name: string;
  value: number;
  detail: string;
  you: boolean;
}

/** Best payout multiple this week per opted-in player (stakes of at least 1 credit). */
export async function weeklyMultipliers(viewerId: string | null, limit = 20) {
  const res = await getDb().execute<{ user_id: string; name: string; best: string; game: string }>(sql`
    SELECT DISTINCT ON (r.user_id) r.user_id, coalesce(u.display_name, u.username) AS name,
           (r.payout_total * 100 / r.stake_total)::text AS best, g.name AS game
    FROM game_rounds r JOIN users u ON u.id = r.user_id JOIN games g ON g.id = r.game_id
    WHERE r.status = 'SETTLED' AND r.settled_at > now() - interval '7 days' AND r.stake_total >= 100 AND r.payout_total > 0
      AND (${OPTED_IN} OR u.id = ${viewerId})
    ORDER BY r.user_id, r.payout_total * 100 / r.stake_total DESC, r.settled_at`);
  const rows = res.rows
    .map((r) => ({ userId: r.user_id, name: r.name, value: Number(r.best), game: r.game }))
    .sort((a, b) => b.value - a.value);
  return board(rows.map((r) => ({ ...r, detail: r.game })), viewerId, limit);
}

/** Highest levels among opted-in players. */
export async function levelBoard(viewerId: string | null, limit = 20) {
  const res = await getDb().execute<{ user_id: string; xp: string }>(xpQuery(sql`(${OPTED_IN} OR u.id = ${viewerId})`));
  const names = await getDb().execute<{ id: string; name: string }>(sql`
    SELECT u.id, coalesce(u.display_name, u.username) AS name FROM users u WHERE ${OPTED_IN} OR u.id = ${viewerId}`);
  const nameById = new Map(names.rows.map((n) => [n.id, n.name]));
  const rows = res.rows
    .map((r) => {
      const l = levelFromXp(Number(r.xp));
      return { userId: r.user_id, name: nameById.get(r.user_id) ?? 'Player', value: l.xp, detail: `Level ${l.level} · ${l.tier}` };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  return board(rows, viewerId, limit);
}

function board(rows: { userId: string; name: string; value: number; detail: string }[], viewerId: string | null, limit: number) {
  // The viewer is ranked among everyone listed, but only opted-in players are shown to others.
  const ranked = rows.map((r, i) => ({ rank: i + 1, ...r, you: r.userId === viewerId }));
  const top = ranked.slice(0, limit).map(({ userId: _u, ...r }) => r);
  const mine = ranked.find((r) => r.you);
  return { top, you: mine ? { rank: mine.rank, value: mine.value, detail: mine.detail } : null };
}
