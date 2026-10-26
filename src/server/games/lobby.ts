import { asc, eq } from 'drizzle-orm';
import { getGameModule } from '@/engine/games/registry';
import { isGameId } from '@/engine/games/types';
import { getDb } from '../db/client';
import { gameConfigurations, games, riskLimits } from '../db/schema';
import { CATALOG, parseConfig, requireGameId } from './catalog';

export interface GameSummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  statusReason: string | null;
  interactive: boolean;
  tagline: string;
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
      return {
        id: r.game.id,
        name: r.game.name,
        status: r.game.status,
        statusReason: r.game.statusReason,
        interactive: r.game.interactive,
        tagline: CATALOG[requireGameId(r.game.id)]!.tagline,
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
