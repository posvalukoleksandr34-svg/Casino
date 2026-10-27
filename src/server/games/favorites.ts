/**
 * Lobby personalisation: favourite games and recently played games. Both are
 * scoped to the signed-in player; game ids are validated against the catalogue.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { games, userFavorites } from '../db/schema';
import { errors } from '../errors';
import { requireGameId } from './catalog';

export async function listFavorites(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ gameId: userFavorites.gameId })
    .from(userFavorites)
    .where(eq(userFavorites.userId, userId))
    .orderBy(asc(userFavorites.createdAt));
  return rows.map((r) => r.gameId);
}

/** Idempotent: adding an existing favourite is a no-op. Disabled games cannot be added. */
export async function addFavorite(userId: string, rawGameId: string): Promise<string[]> {
  const gameId = requireGameId(rawGameId);
  const db = getDb();
  const [game] = await db.select({ status: games.status }).from(games).where(eq(games.id, gameId));
  if (!game || game.status === 'DISABLED') throw errors.notFound('Game');
  await db.insert(userFavorites).values({ userId, gameId }).onConflictDoNothing();
  return listFavorites(userId);
}

/** Idempotent: removing a game that is not a favourite is a no-op. */
export async function removeFavorite(userId: string, rawGameId: string): Promise<string[]> {
  const gameId = requireGameId(rawGameId);
  await getDb()
    .delete(userFavorites)
    .where(and(eq(userFavorites.userId, userId), eq(userFavorites.gameId, gameId)));
  return listFavorites(userId);
}

export interface RecentGame {
  gameId: string;
  lastPlayedAt: string;
}

/** Games the player started a round in, most recent first (from the round history; nothing extra is stored). */
export async function recentlyPlayed(userId: string, limit = 6): Promise<RecentGame[]> {
  const res = await getDb().execute<{ game_id: string; last: Date | string }>(sql`
    SELECT game_id, max(started_at) AS last
    FROM game_rounds
    WHERE user_id = ${userId}
    GROUP BY game_id
    ORDER BY last DESC
    LIMIT ${limit}`);
  return res.rows.map((r) => ({ gameId: r.game_id, lastPlayedAt: new Date(r.last).toISOString() }));
}
