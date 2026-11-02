import { SLOT_MODULES } from '@/engine/games/slots';

export const TX_LABELS: Record<string, string> = {
  BET_PLACED: 'Wager',
  BET_SETTLED: 'Settlement',
  ROUND_VOIDED: 'Refund',
  BONUS_GRANTED: 'Bonus',
  ADJUSTMENT: 'Correction',
  CHIP_GRANT: 'Test chips granted',
  HOUSE_FUNDING: 'House funding',
  SPORTS_STAKE: 'Prediction stake',
  SPORTS_SETTLED: 'Prediction settled',
  SPORTS_VOIDED: 'Prediction refund',
  SPORTS_CORRECTION: 'Prediction correction',
};

export const GAME_NAMES: Record<string, string> = {
  roulette: 'European Roulette',
  dice: 'Dice',
  crash: 'Crash',
  mines: 'Mines',
  blackjack: 'Blackjack',
  slots: 'Slots',
  limbo: 'Limbo',
  keno: 'Keno',
  plinko: 'Plinko',
  hilo: 'Hi-Lo',
  ...Object.fromEntries(Object.entries(SLOT_MODULES).map(([id, m]) => [id, m.name])),
};

/** Game status as shown to staff (SUSPENDED is the "maintenance" state). */
export const GAME_STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', SUSPENDED: 'Maintenance', DISABLED: 'Disabled' };
