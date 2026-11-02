/**
 * Player levels: cosmetic only. A level unlocks nothing and pays nothing.
 *
 * Experience is derived from the player's own records, so nothing extra is
 * stored and nothing can drift:
 *   - 2 XP per settled round, at most 30 rounds per UTC day (≤ 60 XP a day),
 *     so long sessions do not level faster than steady, moderate play;
 *   - 40 XP per different game tried;
 *   - 150 XP per achievement.
 * Reaching level L + 1 takes 50·L·(L + 1) XP in total (100 for level 2,
 * 300 for level 3, 4,500 for level 10).
 */
import { sql } from 'drizzle-orm';
import type { Executor } from '../db/client';

export const XP = { perRound: 2, roundsPerDayCap: 30, perGame: 40, perAchievement: 150 } as const;

export const TIERS = [
  { from: 1, name: 'Bronze' },
  { from: 5, name: 'Silver' },
  { from: 10, name: 'Gold' },
  { from: 20, name: 'Platinum' },
  { from: 35, name: 'Diamond' },
] as const;

/** Total XP needed to reach `level` (level 1 needs 0). */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) * level;
}

export function levelFromXp(xp: number) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level += 1;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const tier = [...TIERS].reverse().find((t) => level >= t.from)!.name;
  return { level, tier, xp, levelXp: xp - floor, levelSpan: next - floor, nextAt: next };
}

/** SQL for XP per user, restricted by a WHERE fragment on users `u`. */
export function xpQuery(where: ReturnType<typeof sql>) {
  return sql`
    WITH days AS (
      SELECT r.user_id, least(count(*), ${XP.roundsPerDayCap}) AS n
      FROM game_rounds r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'SETTLED' AND ${where}
      GROUP BY r.user_id, (r.settled_at AT TIME ZONE 'UTC')::date
    ), play AS (SELECT user_id, sum(n) * ${XP.perRound} AS xp FROM days GROUP BY user_id),
    variety AS (
      SELECT r.user_id, count(DISTINCT r.game_id) * ${XP.perGame} AS xp
      FROM game_rounds r JOIN users u ON u.id = r.user_id WHERE r.status = 'SETTLED' AND ${where} GROUP BY r.user_id
    ), ach AS (
      SELECT a.user_id, count(*) * ${XP.perAchievement} AS xp
      FROM user_achievements a JOIN users u ON u.id = a.user_id WHERE ${where} GROUP BY a.user_id
    )
    SELECT u.id AS user_id, (coalesce(p.xp, 0) + coalesce(v.xp, 0) + coalesce(a.xp, 0))::text AS xp
    FROM users u LEFT JOIN play p ON p.user_id = u.id LEFT JOIN variety v ON v.user_id = u.id LEFT JOIN ach a ON a.user_id = u.id
    WHERE ${where}`;
}

export async function playerLevel(db: Executor, userId: string) {
  const res = await db.execute<{ user_id: string; xp: string }>(xpQuery(sql`u.id = ${userId}`));
  return levelFromXp(Number(res.rows[0]?.xp ?? 0));
}
