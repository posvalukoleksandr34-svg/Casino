import { asc, eq, sql } from 'drizzle-orm';
import { getGameModule } from '@/engine/games/registry';
import { isGameId } from '@/engine/games/types';
import { getDb } from '../db/client';
import { gameConfigurations, games, riskLimits } from '../db/schema';
import { CATALOG, isNewGame, parseConfig, requireGameId, type GameCategory } from './catalog';

export interface GameSummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  statusReason: string | null;
  interactive: boolean;
  tagline: string;
  categories: GameCategory[];
  addedOn: string;
  isNew: boolean;
  configVersion: number;
  config: unknown;
  theoretical: ReturnType<ReturnType<typeof getGameModule>['theoretical']>;
  limits: { minStake: number; maxStake: number; maxPayoutPerRound: number };
}

/** Public game catalogue. Never includes RNG internals or seeds. */
export async function listGames(opts: { includeDisabled?: boolean } = {}): Promise<GameSummary[]> {
  const rows = await getDb()
    .select({ game: games, configId: gameConfigurations.id, version: gameConfigurations.version, config: gameConfigurations.config, limits: riskLimits })
    .from(games)
    .innerJoin(gameConfigurations, eq(gameConfigurations.gameId, games.id))
    .innerJoin(riskLimits, eq(riskLimits.gameId, games.id))
    .where(eq(gameConfigurations.isActive, true))
    .orderBy(asc(games.sortOrder));
  return rows
    .filter((r) => opts.includeDisabled || r.game.status !== 'DISABLED')
    .filter((r) => isGameId(r.game.id) && Boolean(CATALOG[r.game.id]))
    .map((r) => {
      const mod = getGameModule(requireGameId(r.game.id));
      const config = parseConfig(mod, r.configId, r.config);
      const entry = CATALOG[requireGameId(r.game.id)]!;
      return {
        id: r.game.id,
        name: r.game.name,
        status: r.game.status,
        statusReason: r.game.statusReason,
        interactive: r.game.interactive,
        tagline: entry.tagline,
        categories: entry.categories,
        addedOn: entry.addedOn,
        isNew: isNewGame(entry),
        configVersion: r.version,
        config,
        theoretical: mod.theoretical(config),
        limits: { minStake: r.limits.minStake, maxStake: r.limits.maxStake, maxPayoutPerRound: r.limits.maxPayoutPerRound },
      };
    });
}

export async function getGameSummary(id: string): Promise<GameSummary | undefined> {
  return (await listGames({ includeDisabled: true })).find((g) => g.id === id);
}

/**
 * Most-played games by settled rounds in the last `days` days (an aggregate
 * count only: no player data). Games with no rounds keep catalogue order.
 */
export async function popularGameIds(days = 7, limit = 6): Promise<string[]> {
  const res = await getDb().execute<{ game_id: string; n: string }>(sql`
    SELECT game_id, count(*)::text AS n FROM game_rounds
    WHERE started_at > now() - make_interval(days => ${days})
    GROUP BY game_id ORDER BY count(*) DESC, game_id LIMIT ${limit}`);
  return res.rows.map((r) => r.game_id);
}
