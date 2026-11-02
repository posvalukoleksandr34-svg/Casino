import { SLOT_MODULES } from '@/engine/games/slots';

export const TX_LABELS: Record<string, string> = {
  BET_PLACED: 'Wager',
  BET_SETTLED: 'Settlement',
  ROUND_VOIDED: 'Refund',
  BONUS_GRANTED: 'Free credits',
  ADJUSTMENT: 'Correction',
  CHIP_GRANT: 'Test chips granted',
  HOUSE_FUNDING: 'House funding',
  SPORTS_STAKE: 'Prediction stake',
  SPORTS_SETTLED: 'Prediction settled',
  SPORTS_VOIDED: 'Prediction refund',
  SPORTS_CORRECTION: 'Prediction correction',
  BONUS_CLAIMED: 'Bonus claimed (locked)',
  BONUS_RELEASED: 'Bonus released',
  BONUS_FORFEITED: 'Bonus forfeited',
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

/** Player-visible names of account activity (audit actions performed by the player or the system for them). */
export const ACTIVITY_LABELS: Record<string, string> = {
  'user.registered': 'Account created',
  'user.profile_updated': 'Profile updated',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.account_locked': 'Account temporarily locked',
  'auth.password_changed': 'Password changed',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset': 'Password reset',
  'bonus.daily_claimed': 'Free top-up received',
  'bonus.claimed': 'Bonus claimed',
  'bonus.completed': 'Bonus released to wallet',
  'bonus.forfeited': 'Bonus forfeited',
  'bonus.expired': 'Bonus expired',
  'fairness.seed_rotated': 'Provably fair seed rotated',
  'responsible.limits_updated': 'Play limits updated',
  'responsible.cool_off': 'Cool-off started',
  'responsible.self_excluded': 'Self-exclusion started',
  'user.data_exported': 'Personal data exported',
  'user.email_verified': 'E-mail address confirmed',
  'user.onboarding_completed': 'Profile completed',
  'user.details_updated': 'Personal details updated',
  'auth.verification_code_sent': 'Verification code sent',
  'auth.email_verification_failed': 'Incorrect verification code entered',
  'auth.signup_email_changed': 'Registration e-mail corrected',
  'auth.email_change_requested': 'E-mail change requested',
  'auth.email_change_cancelled': 'E-mail change cancelled',
  'auth.email_changed': 'E-mail address changed',
};
