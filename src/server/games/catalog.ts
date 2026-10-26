/**
 * Bridges the pure engine modules with persisted game state: which games
 * exist, their status, the active immutable configuration version and the
 * default risk limits used at bootstrap.
 */
import { and, eq } from 'drizzle-orm';
import { type z } from 'zod';
import { getGameModule } from '@/engine/games/registry';
import { isGameId, type GameId, type GameModule } from '@/engine/games/types';
import type { Executor } from '../db/client';
import { gameConfigurations, games, type GameStatus } from '../db/schema';
import { errors } from '../errors';

const CHIP = 100;

export interface CatalogEntry {
  id: GameId;
  sortOrder: number;
  initialStatus: GameStatus;
  limits: { minStake: number; maxStake: number; maxPayoutPerRound: number; maxGameExposure: number };
  tagline: string;
}

export const CATALOG: Partial<Record<GameId, CatalogEntry>> = {
  roulette: {
    id: 'roulette',
    sortOrder: 10,
    initialStatus: 'ACTIVE',
    tagline: 'Single-zero wheel. Straight-up, colours, dozens and columns.',
    limits: { minStake: 10, maxStake: 10_000 * CHIP, maxPayoutPerRound: 360_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  dice: {
    id: 'dice',
    sortOrder: 20,
    initialStatus: 'ACTIVE',
    tagline: 'Pick your odds. 1% house edge, multipliers up to 99×.',
    limits: { minStake: 10, maxStake: 10_000 * CHIP, maxPayoutPerRound: 100_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
};

export function catalogEntries(): CatalogEntry[] {
  return Object.values(CATALOG)
    .filter((e): e is CatalogEntry => Boolean(e))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function requireGameId(raw: string): GameId {
  if (!isGameId(raw) || !CATALOG[raw]) throw errors.notFound('Game');
  return raw;
}

const configCache = new Map<number, unknown>();

/** Parses (and caches) an immutable configuration version. */
export function parseConfig(mod: GameModule, configId: number, raw: unknown): unknown {
  const hit = configCache.get(configId);
  if (hit !== undefined) return hit;
  const parsed = mod.configSchema.parse(raw);
  configCache.set(configId, parsed);
  return parsed;
}

export interface ActiveGame {
  id: GameId;
  name: string;
  status: GameStatus;
  statusReason: string | null;
  mod: GameModule;
  configId: number;
  configVersion: number;
  config: unknown;
}

export async function loadActiveGame(db: Executor, rawId: string): Promise<ActiveGame> {
  const id = requireGameId(rawId);
  const [row] = await db
    .select({
      name: games.name,
      status: games.status,
      statusReason: games.statusReason,
      configId: gameConfigurations.id,
      version: gameConfigurations.version,
      config: gameConfigurations.config,
    })
    .from(games)
    .innerJoin(gameConfigurations, and(eq(gameConfigurations.gameId, games.id), eq(gameConfigurations.isActive, true)))
    .where(eq(games.id, id));
  if (!row) throw errors.notFound('Game');
  const mod = getGameModule(id);
  return {
    id,
    name: row.name,
    status: row.status,
    statusReason: row.statusReason,
    mod,
    configId: row.configId,
    configVersion: row.version,
    config: parseConfig(mod, row.configId, row.config),
  };
}

export async function loadConfigById(db: Executor, mod: GameModule, configId: number): Promise<unknown> {
  const hit = configCache.get(configId);
  if (hit !== undefined) return hit;
  const [row] = await db.select({ config: gameConfigurations.config }).from(gameConfigurations).where(eq(gameConfigurations.id, configId));
  if (!row) throw new Error(`configuration ${configId} not found`);
  return parseConfig(mod, configId, row.config);
}

/** Parses untrusted input with a module schema, converting failures to a 400. */
export function parseWith<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw errors.validation(`Invalid ${what}`, {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}
