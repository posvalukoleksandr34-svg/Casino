import { slotModule } from './engine';
import { CORAL_DEEP, EMBER_FRUITS, FROST_CROWN, LANTERN_HOLLOW, SANDS_OF_AURUM } from './machines';

export const lanternHollow = slotModule('lantern-hollow', 'Lantern Hollow', LANTERN_HOLLOW);
export const emberFruits = slotModule('ember-fruits', 'Ember Fruits', EMBER_FRUITS);
export const sandsOfAurum = slotModule('sands-of-aurum', 'Sands of Aurum', SANDS_OF_AURUM);
export const coralDeep = slotModule('coral-deep', 'Coral Deep', CORAL_DEEP);
export const frostCrown = slotModule('frost-crown', 'Frost Crown', FROST_CROWN);

/** Every video slot. Adding one: reels and paytable in machines.ts, a module here, then its art, look, cover, catalog entry and rules. */
export const SLOT_GAME_IDS = ['lantern-hollow', 'ember-fruits', 'sands-of-aurum', 'coral-deep', 'frost-crown'] as const;
export type SlotGameId = (typeof SLOT_GAME_IDS)[number];
export const SLOT_MODULES = {
  'lantern-hollow': lanternHollow,
  'ember-fruits': emberFruits,
  'sands-of-aurum': sandsOfAurum,
  'coral-deep': coralDeep,
  'frost-crown': frostCrown,
} as const satisfies Record<SlotGameId, unknown>;

export function isSlotGameId(id: string): id is SlotGameId {
  return (SLOT_GAME_IDS as readonly string[]).includes(id);
}
