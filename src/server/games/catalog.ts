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

export const GAME_CATEGORIES = {
  table: 'Table games',
  cards: 'Card games',
  instant: 'Instant results',
  'cash-out': 'Cash out any time',
} as const;
export type GameCategory = keyof typeof GAME_CATEGORIES;

/** The launch catalogue's date; games added later are listed as new for NEW_GAME_DAYS. */
export const CATALOG_LAUNCH_DATE = '2026-10-26';
export const NEW_GAME_DAYS = 60;

export interface CatalogEntry {
  id: GameId;
  sortOrder: number;
  initialStatus: GameStatus;
  limits: { minStake: number; maxStake: number; maxPayoutPerRound: number; maxGameExposure: number };
  tagline: string;
  categories: GameCategory[];
  /** Date the game was added to the catalogue (ISO, from the repository history). */
  addedOn: string;
}

export function isNewGame(entry: Pick<CatalogEntry, 'addedOn'>, now = new Date()): boolean {
  if (entry.addedOn <= CATALOG_LAUNCH_DATE) return false;
  return now.getTime() - Date.parse(`${entry.addedOn}T00:00:00Z`) <= NEW_GAME_DAYS * 86_400_000;
}

export const CATALOG: Partial<Record<GameId, CatalogEntry>> = {
  roulette: {
    id: 'roulette',
    categories: ['table'],
    addedOn: '2026-10-26',
    sortOrder: 10,
    initialStatus: 'ACTIVE',
    tagline: 'Single-zero wheel. Straight-up, colours, dozens and columns.',
    limits: { minStake: 10, maxStake: 10_000 * CHIP, maxPayoutPerRound: 360_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  dice: {
    id: 'dice',
    categories: ['instant'],
    addedOn: '2026-10-26',
    sortOrder: 20,
    initialStatus: 'ACTIVE',
    tagline: 'Pick your odds. 1% house edge, multipliers up to 99×.',
    limits: { minStake: 10, maxStake: 10_000 * CHIP, maxPayoutPerRound: 100_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  mines: {
    id: 'mines',
    categories: ['cash-out'],
    addedOn: '2026-10-26',
    sortOrder: 30,
    initialStatus: 'ACTIVE',
    tagline: 'Uncover safe tiles, cash out whenever you like. Exact odds at every step.',
    limits: { minStake: 10, maxStake: 1_000 * CHIP, maxPayoutPerRound: 1_000_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  crash: {
    id: 'crash',
    categories: ['cash-out'],
    addedOn: '2026-10-26',
    sortOrder: 40,
    initialStatus: 'ACTIVE',
    tagline: 'Watch the multiplier climb and cash out before it crashes.',
    limits: { minStake: 10, maxStake: 1_000 * CHIP, maxPayoutPerRound: 1_000_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  blackjack: {
    id: 'blackjack',
    categories: ['table', 'cards'],
    addedOn: '2026-10-26',
    sortOrder: 50,
    initialStatus: 'ACTIVE',
    tagline: 'Six decks, dealer stands on soft 17, blackjack pays 3:2. Fresh shoe every hand.',
    // A hand can grow to 4 split hands, each doubled: worst case 16× the initial stake (+ insurance 1.5×).
    limits: { minStake: 100, maxStake: 5_000 * CHIP, maxPayoutPerRound: 100_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  limbo: {
    id: 'limbo',
    categories: ['instant'],
    addedOn: '2026-10-27',
    sortOrder: 60,
    initialStatus: 'ACTIVE',
    tagline: 'Set a target multiplier; win it if the result reaches it. 1% house edge at every target.',
    // Targets up to 10,000×: the per-round cap limits the stake on the highest targets.
    limits: { minStake: 10, maxStake: 1_000 * CHIP, maxPayoutPerRound: 1_000_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  keno: {
    id: 'keno',
    categories: ['instant'],
    addedOn: '2026-10-27',
    sortOrder: 70,
    initialStatus: 'ACTIVE',
    tagline: 'Pick 1–10 numbers from 40; ten are drawn. Published payout table for every pick count.',
    // Top prize 3,509.94× (10 of 10): 250 chips × 3,509.94 stays under the per-round cap.
    limits: { minStake: 10, maxStake: 250 * CHIP, maxPayoutPerRound: 1_000_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  plinko: {
    id: 'plinko',
    categories: ['instant'],
    addedOn: '2026-10-27',
    sortOrder: 80,
    initialStatus: 'ACTIVE',
    tagline: 'Drop a ball through 8, 12 or 16 rows. Risk changes the spread, not the return.',
    // Top multiplier 187.64× (16 rows, high risk).
    limits: { minStake: 10, maxStake: 1_000 * CHIP, maxPayoutPerRound: 200_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
  },
  hilo: {
    id: 'hilo',
    categories: ['cards', 'cash-out'],
    addedOn: '2026-10-27',
    sortOrder: 90,
    initialStatus: 'ACTIVE',
    tagline: 'Higher or lower? Exact odds on every card, cash out after any correct guess.',
    // Multiplier cap 1,000× cashes out automatically.
    limits: { minStake: 10, maxStake: 1_000 * CHIP, maxPayoutPerRound: 1_000_000 * CHIP, maxGameExposure: 50_000_000 * CHIP },
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
