import { slotModule } from './engine';
import { EMBER_FRUITS, LANTERN_HOLLOW, SANDS_OF_AURUM } from './machines';

export const lanternHollow = slotModule('lantern-hollow', 'Lantern Hollow', LANTERN_HOLLOW);
export const emberFruits = slotModule('ember-fruits', 'Ember Fruits', EMBER_FRUITS);
export const sandsOfAurum = slotModule('sands-of-aurum', 'Sands of Aurum', SANDS_OF_AURUM);

export const SLOT_GAME_IDS = ['lantern-hollow', 'ember-fruits', 'sands-of-aurum'] as const;
export type SlotGameId = (typeof SLOT_GAME_IDS)[number];
export const SLOT_MODULES = { 'lantern-hollow': lanternHollow, 'ember-fruits': emberFruits, 'sands-of-aurum': sandsOfAurum } as const;
