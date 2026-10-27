import { blackjack } from './blackjack';
import { crash } from './crash';
import { dice } from './dice';
import { hilo } from './hilo';
import { keno } from './keno';
import { limbo } from './limbo';
import { mines } from './mines';
import { plinko } from './plinko';
import { roulette } from './roulette';
import type { GameId, GameModule } from './types';

/**
 * Type-erased registry. Callers must parse configs/bets/actions with the
 * module's own Zod schemas before invoking it, which restores type safety at
 * the boundary.
 */
const modules: Partial<Record<GameId, GameModule>> = {
  roulette: roulette as unknown as GameModule,
  dice: dice as unknown as GameModule,
  mines: mines as unknown as GameModule,
  crash: crash as unknown as GameModule,
  blackjack: blackjack as unknown as GameModule,
  limbo: limbo as unknown as GameModule,
  keno: keno as unknown as GameModule,
  plinko: plinko as unknown as GameModule,
  hilo: hilo as unknown as GameModule,
};

export function getGameModule(id: GameId): GameModule {
  const mod = modules[id];
  if (!mod) throw new Error(`game module not registered: ${id}`);
  return mod;
}

export function registeredGames(): GameModule[] {
  return Object.values(modules).filter((m): m is GameModule => Boolean(m));
}
