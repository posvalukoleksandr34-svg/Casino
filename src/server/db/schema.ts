/**
 * Drizzle table definitions. The SQL in /migrations is the source of truth
 * (it also carries triggers and constraints Drizzle cannot express); this
 * file mirrors it for type-safe queries. tests/integration/schema-drift.test.ts
 * fails if the two diverge.
 */
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userRole = pgEnum('user_role', ['PLAYER', 'SUPPORT', 'RISK_MANAGER', 'AUDITOR', 'ADMIN', 'OWNER', 'FINANCE_MANAGER', 'COMPLIANCE_MANAGER']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'DELETED']);
export const accountType = pgEnum('account_type', [
  'PLAYER_WALLET',
  'HOUSE_BANKROLL',
  'WAGERS_IN_PLAY',
  'SPORTS_IN_PLAY',
  'PROMOTIONS',
  'ADJUSTMENTS',
  'ISSUANCE',
  'BONUS_LOCKED',
  'PENDING_WITHDRAWALS',
  'PAYMENT_CLEARING',
  'PAYMENT_FEES',
]);
export const ledgerTxType = pgEnum('ledger_tx_type', [
  'BET_PLACED',
  'BET_SETTLED',
  'ROUND_VOIDED',
  'BONUS_GRANTED',
  'ADJUSTMENT',
  'HOUSE_FUNDING',
  'SPORTS_STAKE',
  'SPORTS_SETTLED',
  'SPORTS_VOIDED',
  'SPORTS_CORRECTION',
  'CHIP_GRANT',
  'BONUS_CLAIMED',
  'BONUS_RELEASED',
  'BONUS_FORFEITED',
  'DEPOSIT',
  'WITHDRAWAL_HOLD',
  'WITHDRAWAL_PAID',
  'WITHDRAWAL_RELEASED',
]);
export const gameStatus = pgEnum('game_status', ['ACTIVE', 'SUSPENDED', 'DISABLED']);
export const roundStatus = pgEnum('round_status', ['OPEN', 'SETTLED', 'VOIDED']);
export const seedStatus = pgEnum('seed_status', ['ACTIVE', 'REVEALED']);

export type UserRole = (typeof userRole.enumValues)[number];
export type UserStatus = (typeof userStatus.enumValues)[number];
export type AccountType = (typeof accountType.enumValues)[number];
export type LedgerTxType = (typeof ledgerTxType.enumValues)[number];
export type GameStatus = (typeof gameStatus.enumValues)[number];
export type RoundStatus = (typeof roundStatus.enumValues)[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  username: text('username').notNull(),
  passwordHash: text('password_hash'),
  role: userRole('role').notNull().default('PLAYER'),
  status: userStatus('status').notNull().default('ACTIVE'),
  statusReason: text('status_reason'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  lastLoginAt: ts('last_login_at'),
  deletedAt: ts('deleted_at'),
  /** Optional name shown on the player's own profile (migration 0005). */
  displayName: text('display_name'),
  /** Built-in avatar preset id (no uploads). */
  avatar: text('avatar'),
  /** When the current e-mail address was confirmed (migration 0009); NULL = registration not verified yet. */
  emailVerifiedAt: ts('email_verified_at'),
  /** CODE, OPERATOR or LEGACY_MIGRATION (an assumption for pre-0009 accounts, not proof). */
  emailVerificationMethod: text('email_verification_method').$type<EmailVerificationMethod>(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  /** Calendar date (YYYY-MM-DD), no time zone. */
  dateOfBirth: date('date_of_birth', { mode: 'string' }),
  /** ISO 3166-1 alpha-2. */
  countryCode: text('country_code'),
  /** E.164, e.g. +442071838750. */
  phoneE164: text('phone_e164'),
  /** Set only by a successful phone challenge (none exists yet): a stored number is not a verified one. */
  phoneVerifiedAt: ts('phone_verified_at'),
  /** TRUE for accounts registered after migration 0009; FALSE for grandfathered ones. */
  onboardingRequired: boolean('onboarding_required').notNull().default(true),
  onboardingCompletedAt: ts('onboarding_completed_at'),
  termsVersion: text('terms_version'),
  termsAcceptedAt: ts('terms_accepted_at'),
  privacyVersion: text('privacy_version'),
  privacyAcceptedAt: ts('privacy_accepted_at'),
  /** Result of a third-party age check (migration 0010); NULL = only the self-declared date of birth. */
  ageVerifiedAt: ts('age_verified_at'),
  ageVerificationProvider: text('age_verification_provider'),
  ageVerificationRef: text('age_verification_ref'),
  /** Identity verification state (migration 0013). Only a reviewer or provider moves it to VERIFIED. */
  kycStatus: text('kyc_status').$type<KycStatus>().notNull().default('NOT_STARTED'),
  kycUpdatedAt: ts('kyc_updated_at'),
  /** Lifetime casino wagering counted for VIP tiers (at settlement). */
  vipWagered: money('vip_wagered').notNull().default(0),
  vipLevel: integer('vip_level').notNull().default(1),
});

export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';

export type EmailVerificationMethod = 'CODE' | 'OPERATOR' | 'LEGACY_MIGRATION';
/** FAILED = temporary delivery failure; REJECTED = permanently refused by the receiving side (migration 0010). */
export type ChallengeDelivery = 'PENDING' | 'SENT' | 'FAILED' | 'REJECTED';

export const emailVerificationChallenges = pgTable('email_verification_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  purpose: text('purpose').$type<'SIGNUP' | 'EMAIL_CHANGE'>().notNull(),
  email: text('email').notNull(),
  codeMac: text('code_mac').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  delivery: text('delivery').$type<ChallengeDelivery>().notNull().default('PENDING'),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  supersededAt: ts('superseded_at'),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  userAgent: text('user_agent'),
  ipHash: text('ip_hash'),
  /** When this session passed the second factor (migration 0008). */
  mfaVerifiedAt: ts('mfa_verified_at'),
});

/** Staff TOTP enrolment (migration 0008). The secret is encrypted with the seed key ring. */
export const userMfa = pgTable('user_mfa', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  secretEnc: text('secret_enc').notNull(),
  enabledAt: ts('enabled_at'),
  lastStep: bigint('last_step', { mode: 'number' }).notNull().default(0),
  recoveryHashes: text('recovery_hashes').array().notNull().default([]),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});

export const games = pgTable('games', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  interactive: boolean('interactive').notNull(),
  status: gameStatus('status').notNull().default('DISABLED'),
  statusReason: text('status_reason'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const gameConfigurations = pgTable('game_configurations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  gameId: text('game_id').notNull().references(() => games.id),
  version: integer('version').notNull(),
  config: jsonb('config').$type<unknown>().notNull(),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
});

export const riskLimits = pgTable('risk_limits', {
  gameId: text('game_id').primaryKey().references(() => games.id),
  minStake: money('min_stake').notNull(),
  maxStake: money('max_stake').notNull(),
  maxPayoutPerRound: money('max_payout_per_round').notNull(),
  maxGameExposure: money('max_game_exposure').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey(),
  newRoundsEnabled: boolean('new_rounds_enabled').notNull().default(true),
  incidentMessage: text('incident_message'),
  maxTotalExposure: money('max_total_exposure').notNull(),
  minHouseReserve: money('min_house_reserve').notNull(),
  maxPlayerBalance: money('max_player_balance').notNull(),
  signupBonus: money('signup_bonus').notNull(),
  dailyBonus: money('daily_bonus').notNull(),
  dailyBonusMaxBalance: money('daily_bonus_max_balance').notNull(),
  anomalyZThreshold: doublePrecision('anomaly_z_threshold').notNull().default(4),
  /** Staff must pass TOTP MFA to use the back office (migration 0008). */
  staffMfaRequired: boolean('staff_mfa_required').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  code: text('code').notNull().unique(),
  type: accountType('type').notNull(),
  userId: uuid('user_id').unique().references(() => users.id),
  currency: text('currency').notNull().default('CHIP'),
  balance: money('balance').notNull().default(0),
  entryCount: bigint('entry_count', { mode: 'number' }).notNull().default(0),
  allowNegative: boolean('allow_negative').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const seedPairs = pgTable('seed_pairs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  serverSeedEnc: text('server_seed_enc').notNull(),
  serverSeedHash: text('server_seed_hash').notNull(),
  clientSeed: text('client_seed').notNull(),
  nextNonce: bigint('next_nonce', { mode: 'number' }).notNull().default(0),
  status: seedStatus('status').notNull().default('ACTIVE'),
  createdAt: ts('created_at').notNull().defaultNow(),
  revealedAt: ts('revealed_at'),
  revealedServerSeed: text('revealed_server_seed'),
});

export const gameRounds = pgTable('game_rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  gameId: text('game_id').notNull().references(() => games.id),
  configId: bigint('config_id', { mode: 'number' }).notNull().references(() => gameConfigurations.id),
  status: roundStatus('status').notNull().default('OPEN'),
  seedPairId: bigint('seed_pair_id', { mode: 'number' }).notNull().references(() => seedPairs.id),
  nonce: bigint('nonce', { mode: 'number' }).notNull(),
  clientSeed: text('client_seed').notNull(),
  serverSeedHash: text('server_seed_hash').notNull(),
  stakeTotal: money('stake_total').notNull(),
  payoutTotal: money('payout_total'),
  maxPayout: money('max_payout').notNull(),
  expectedPayout: doublePrecision('expected_payout').notNull(),
  payoutVariance: doublePrecision('payout_variance').notNull(),
  state: jsonb('state').$type<unknown>().notNull(),
  actionCount: integer('action_count').notNull().default(0),
  startedAt: ts('started_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  settledAt: ts('settled_at'),
  voidReason: text('void_reason'),
  /** When the engine says this OPEN round settles by time alone (null: never). */
  expiresAt: ts('expires_at'),
  expiryAttempts: integer('expiry_attempts').notNull().default(0),
});

export const ledgerTransactions = pgTable('ledger_transactions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: ledgerTxType('type').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  userId: uuid('user_id').references(() => users.id),
  roundId: uuid('round_id').references(() => gameRounds.id),
  /** Set on SPORTS_* transactions (migration 0006); never together with roundId. */
  sportsTicketId: uuid('sports_ticket_id').references((): AnyPgColumn => sportsTickets.id),
  reversesId: bigint('reverses_id', { mode: 'number' }),
  actorId: uuid('actor_id').references(() => users.id),
  description: text('description').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const ledgerEntries = pgTable('ledger_entries', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  transactionId: bigint('transaction_id', { mode: 'number' })
    .notNull()
    .references(() => ledgerTransactions.id),
  accountId: bigint('account_id', { mode: 'number' })
    .notNull()
    .references(() => ledgerAccounts.id),
  amount: money('amount').notNull(),
  accountSeq: bigint('account_seq', { mode: 'number' }).notNull().default(0),
  balanceAfter: money('balance_after'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const bets = pgTable('bets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  roundId: uuid('round_id').notNull().references(() => gameRounds.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  seq: integer('seq').notNull(),
  kind: text('kind').notNull(),
  selection: jsonb('selection').$type<Record<string, unknown>>().notNull().default({}),
  stake: money('stake').notNull(),
  ledgerTransactionId: bigint('ledger_transaction_id', { mode: 'number' })
    .notNull()
    .references(() => ledgerTransactions.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const payouts = pgTable('payouts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  roundId: uuid('round_id').notNull().unique().references(() => gameRounds.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  amount: money('amount').notNull(),
  ledgerTransactionId: bigint('ledger_transaction_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => ledgerTransactions.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const bonuses = pgTable('bonuses', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').$type<'SIGNUP' | 'DAILY'>().notNull(),
  claimKey: text('claim_key').notNull().unique(),
  amount: money('amount').notNull(),
  ledgerTransactionId: bigint('ledger_transaction_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => ledgerTransactions.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Promotional campaigns: welcome offers and promo codes (migration 0012). */
export const bonusCampaigns = pgTable('bonus_campaigns', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  slug: text('slug').notNull().unique(),
  kind: text('kind').$type<'WELCOME' | 'PROMO_CODE' | 'DEPOSIT'>().notNull(),
  code: text('code').unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  matchPercent: integer('match_percent').notNull().default(0),
  fixedAmount: money('fixed_amount').notNull().default(0),
  maxBonus: money('max_bonus').notNull(),
  wageringMultiplier: integer('wagering_multiplier').notNull(),
  expiresAfterDays: integer('expires_after_days').notNull(),
  eligibleAccountAgeDays: integer('eligible_account_age_days'),
  startsAt: ts('starts_at').notNull().defaultNow(),
  endsAt: ts('ends_at'),
  maxClaims: integer('max_claims'),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  /** DEPOSIT campaigns: qualifying deposit number (NULL = any deposit). Migration 0013. */
  depositNumber: integer('deposit_number'),
  minDeposit: money('min_deposit').notNull().default(0),
  /** Stakes above this do not count towards wagering. */
  maxBet: money('max_bet'),
  /** Percent of each stake that counts, by game id. */
  gameContributions: jsonb('game_contributions').$type<Record<string, number>>().notNull().default({}),
  defaultContribution: integer('default_contribution').notNull().default(100),
});

export type BonusClaimStatus = 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'FORFEITED';

/** A player's claim of a campaign: locked credits released after wagering (migration 0012). */
export const bonusClaims = pgTable('bonus_claims', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  campaignId: bigint('campaign_id', { mode: 'number' })
    .notNull()
    .references(() => bonusCampaigns.id),
  amount: money('amount').notNull(),
  wageringRequired: money('wagering_required').notNull(),
  wageringProgress: money('wagering_progress').notNull().default(0),
  status: text('status').$type<BonusClaimStatus>().notNull(),
  expiresAt: ts('expires_at').notNull(),
  claimedAt: ts('claimed_at').notNull().defaultNow(),
  closedAt: ts('closed_at'),
  grantTxId: bigint('grant_tx_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => ledgerTransactions.id),
  closeTxId: bigint('close_tx_id', { mode: 'number' })
    .unique()
    .references(() => ledgerTransactions.id),
  /** The deposit a deposit bonus was granted for (migration 0013). */
  depositId: uuid('deposit_id').unique(),
});

export const responsibleLimits = pgTable('responsible_limits', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  dailyLossLimit: money('daily_loss_limit'),
  weeklyLossLimit: money('weekly_loss_limit'),
  dailyWagerLimit: money('daily_wager_limit'),
  sessionLimitMinutes: integer('session_limit_minutes'),
  realityCheckMinutes: integer('reality_check_minutes'),
  pending: jsonb('pending').$type<Record<string, number | null>>(),
  pendingEffectiveAt: ts('pending_effective_at'),
  coolOffUntil: ts('cool_off_until'),
  selfExcludedUntil: ts('self_excluded_until'),
  /** Player-set deposit limits (migration 0013). */
  dailyDepositLimit: money('daily_deposit_limit'),
  monthlyDepositLimit: money('monthly_deposit_limit'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<unknown>(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text('key').notNull(),
    windowStart: ts('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
  actorId: uuid('actor_id').references(() => users.id),
  actorType: text('actor_type').$type<'USER' | 'ADMIN' | 'SYSTEM' | 'ANONYMOUS'>().notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  before: jsonb('before').$type<unknown>(),
  after: jsonb('after').$type<unknown>(),
  reason: text('reason'),
  ipHash: text('ip_hash'),
  requestId: text('request_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  /** Role held by the actor when acting (migration 0008; NULL for older rows). */
  actorRole: text('actor_role'),
  outcome: text('outcome').$type<'SUCCESS' | 'DENIED' | 'FAILED'>().notNull().default('SUCCESS'),
});

export const adminActions = pgTable('admin_actions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  reason: text('reason').notNull(),
  before: jsonb('before').$type<unknown>(),
  after: jsonb('after').$type<unknown>(),
  auditLogId: bigint('audit_log_id', { mode: 'number' })
    .notNull()
    .references(() => auditLogs.id),
});

export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  status: text('status').$type<'RUNNING' | 'OK' | 'MISMATCH' | 'ERROR'>().notNull(),
  mismatchCount: integer('mismatch_count').notNull().default(0),
  checks: jsonb('checks').$type<unknown>().notNull().default([]),
  triggeredBy: text('triggered_by').notNull(),
});

export const alerts = pgTable('alerts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
  kind: text('kind').notNull(),
  severity: text('severity').$type<'INFO' | 'WARNING' | 'CRITICAL'>().notNull(),
  gameId: text('game_id').references(() => games.id),
  message: text('message').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  dedupeKey: text('dedupe_key').unique(),
  acknowledgedAt: ts('acknowledged_at'),
  acknowledgedBy: uuid('acknowledged_by').references(() => users.id),
});

export const errorEvents = pgTable('error_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
  route: text('route'),
  code: text('code').notNull(),
  message: text('message').notNull(),
  requestId: text('request_id'),
});

/** A player's favourite games (migration 0005). */
export const userFavorites = pgTable(
  'user_favorites',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    gameId: text('game_id').notNull().references(() => games.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameId] })],
);

/** Cosmetic badges derived on the server; append-only (migration 0005). */
export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    achievementId: text('achievement_id').notNull(),
    awardedAt: ts('awarded_at').notNull().defaultNow(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

// ---------------------------------------------------------------------------
// Sports prediction simulator (migration 0006).
// ---------------------------------------------------------------------------
export const sportsEventStatus = pgEnum('sports_event_status', ['SCHEDULED', 'LIVE', 'SUSPENDED', 'FINISHED', 'POSTPONED', 'CANCELLED']);
export const sportsMarketStatus = pgEnum('sports_market_status', ['OPEN', 'SUSPENDED', 'CLOSED', 'SETTLED', 'VOIDED']);
export const sportsTicketStatus = pgEnum('sports_ticket_status', ['ACCEPTED', 'SUSPENDED', 'WON', 'LOST', 'VOIDED', 'REJECTED']);
export type SportsEventStatus = (typeof sportsEventStatus.enumValues)[number];
export type SportsMarketStatus = (typeof sportsMarketStatus.enumValues)[number];
export type SportsTicketStatus = (typeof sportsTicketStatus.enumValues)[number];

export const sportsCompetitions = pgTable('sports_competitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  country: text('country'),
  source: text('source').notNull(),
  isDemo: boolean('is_demo').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sportsTeams = pgTable('sports_teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  source: text('source').notNull(),
  isDemo: boolean('is_demo').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sportsEvents = pgTable('sports_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  competitionId: text('competition_id').notNull().references(() => sportsCompetitions.id),
  homeTeamId: text('home_team_id').notNull().references(() => sportsTeams.id),
  awayTeamId: text('away_team_id').notNull().references(() => sportsTeams.id),
  kickoffAt: ts('kickoff_at').notNull(),
  status: sportsEventStatus('status').notNull().default('SCHEDULED'),
  isDemo: boolean('is_demo').notNull(),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  resultVersion: integer('result_version').notNull().default(0),
  resultSource: text('result_source'),
  resultAt: ts('result_at'),
  seedHash: text('seed_hash'),
  seedEnc: text('seed_enc'),
  revealedSeed: text('revealed_seed'),
  model: jsonb('model').$type<Record<string, unknown>>(),
  providerUpdatedAt: ts('provider_updated_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const sportsExternalRefs = pgTable(
  'sports_external_refs',
  {
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    eventId: uuid('event_id').notNull().references(() => sportsEvents.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.externalId] })],
);

export const sportsMarkets = pgTable('sports_markets', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventId: uuid('event_id').notNull().references(() => sportsEvents.id),
  type: text('type').$type<'1X2'>().notNull(),
  status: sportsMarketStatus('status').notNull().default('OPEN'),
  oddsSource: text('odds_source').notNull(),
  oddsUpdatedAt: ts('odds_updated_at').notNull(),
  version: integer('version').notNull().default(1),
  statusReason: text('status_reason'),
  /** Optional operator-set prediction window (migration 0008): NULL = open now / closes at kick-off. */
  opensAt: ts('opens_at'),
  closesAt: ts('closes_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const sportsSelections = pgTable('sports_selections', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  marketId: bigint('market_id', { mode: 'number' }).notNull().references(() => sportsMarkets.id),
  code: text('code').$type<'HOME' | 'DRAW' | 'AWAY'>().notNull(),
  oddsE2: integer('odds_e2'),
});

export const sportsOddsHistory = pgTable('sports_odds_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  selectionId: bigint('selection_id', { mode: 'number' }).notNull().references(() => sportsSelections.id),
  marketVersion: integer('market_version').notNull(),
  oddsE2: integer('odds_e2'),
  source: text('source').notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
});

export const sportsTickets = pgTable('sports_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  slipId: uuid('slip_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  leg: integer('leg').notNull(),
  eventId: uuid('event_id').notNull().references(() => sportsEvents.id),
  marketId: bigint('market_id', { mode: 'number' }).notNull().references(() => sportsMarkets.id),
  selectionId: bigint('selection_id', { mode: 'number' }).notNull().references(() => sportsSelections.id),
  selectionCode: text('selection_code').$type<'HOME' | 'DRAW' | 'AWAY'>().notNull(),
  marketVersion: integer('market_version').notNull(),
  stake: money('stake').notNull(),
  oddsE2: integer('odds_e2').notNull(),
  potentialReturn: money('potential_return').notNull(),
  status: sportsTicketStatus('status').notNull(),
  rejectReason: text('reject_reason'),
  payout: money('payout'),
  settlementSource: text('settlement_source'),
  settlementVersion: integer('settlement_version'),
  isDemo: boolean('is_demo').notNull(),
  placedAt: ts('placed_at').notNull().defaultNow(),
  settledAt: ts('settled_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const sportsResultLog = pgTable('sports_result_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventId: uuid('event_id').notNull().references(() => sportsEvents.id),
  version: integer('version').notNull(),
  kind: text('kind').$type<'RESULT' | 'VOID' | 'CORRECTION'>().notNull(),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  reason: text('reason').notNull(),
  source: text('source').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sportsSettlements = pgTable('sports_settlements', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ticketId: uuid('ticket_id').notNull().references(() => sportsTickets.id),
  version: integer('version').notNull(),
  outcome: text('outcome').$type<'WON' | 'LOST' | 'VOIDED'>().notNull(),
  entitlement: money('entitlement').notNull(),
  credited: money('credited').notNull(),
  ledgerTransactionId: bigint('ledger_transaction_id', { mode: 'number' }).references(() => ledgerTransactions.id),
  source: text('source').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const userSportsFavorites = pgTable(
  'user_sports_favorites',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    kind: text('kind').$type<'team' | 'competition'>().notNull(),
    refId: text('ref_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.refId] })],
);

export const sportsProviderStatus = pgTable('sports_provider_status', {
  provider: text('provider').primaryKey(),
  lastSuccessAt: ts('last_success_at'),
  lastErrorAt: ts('last_error_at'),
  lastError: text('last_error'),
  requestsRemaining: integer('requests_remaining'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export type ApprovalAction = 'ledger.grant' | 'ledger.adjustment' | 'house.fund' | 'security.staff_mfa_disable';
export type ApprovalStatus = 'PENDING' | 'EXECUTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

/** Four-eyes requests for sensitive staff operations (migration 0010). */
export const adminApprovalRequests = pgTable('admin_approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  action: text('action').$type<ApprovalAction>().notNull(),
  targetType: text('target_type').$type<'user' | 'account' | 'platform'>().notNull(),
  targetId: text('target_id').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  reason: text('reason').notNull(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id),
  requestedRole: text('requested_role').notNull(),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  status: text('status').$type<ApprovalStatus>().notNull().default('PENDING'),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedRole: text('decided_role'),
  decidedAt: ts('decided_at'),
  decisionNote: text('decision_note'),
  result: jsonb('result').$type<Record<string, unknown>>(),
});

/** SMS verification codes (migration 0010); only an HMAC of each code is stored. */
export const phoneVerificationChallenges = pgTable('phone_verification_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  phoneE164: text('phone_e164').notNull(),
  codeMac: text('code_mac').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  provider: text('provider').notNull(),
  delivery: text('delivery').$type<ChallengeDelivery>().notNull().default('PENDING'),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  supersededAt: ts('superseded_at'),
});

/** Automatic roulette table: one committed server seed per UTC day (migration 0011; append-only). */
export const rouletteTableDays = pgTable('roulette_table_days', {
  day: date('day', { mode: 'string' }).primaryKey(),
  serverSeedEnc: text('server_seed_enc').notNull(),
  serverSeedHash: text('server_seed_hash').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Public history of table (spectator) spins — not wagers; no user, wallet or ledger link (migration 0011; append-only). */
export const rouletteTableSpins = pgTable('roulette_table_spins', {
  slot: bigint('slot', { mode: 'number' }).primaryKey(),
  day: date('day', { mode: 'string' })
    .notNull()
    .references(() => rouletteTableDays.day),
  result: smallint('result').notNull(),
  closedAt: ts('closed_at').notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Cashier (migration 0013). Only the sandbox provider exists in this code base.
// ---------------------------------------------------------------------------
export const paymentMethods = pgTable('payment_methods', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').$type<'CARD' | 'BANK_TRANSFER' | 'E_WALLET'>().notNull(),
  provider: text('provider').notNull(),
  sandbox: boolean('sandbox').notNull(),
  depositEnabled: boolean('deposit_enabled').notNull().default(true),
  withdrawalEnabled: boolean('withdrawal_enabled').notNull().default(true),
  minDeposit: money('min_deposit').notNull(),
  maxDeposit: money('max_deposit').notNull(),
  minWithdrawal: money('min_withdrawal').notNull(),
  maxWithdrawal: money('max_withdrawal').notNull(),
  depositFeeFixed: money('deposit_fee_fixed').notNull().default(0),
  depositFeeBp: integer('deposit_fee_bp').notNull().default(0),
  withdrawalFeeFixed: money('withdrawal_fee_fixed').notNull().default(0),
  withdrawalFeeBp: integer('withdrawal_fee_bp').notNull().default(0),
  processingTime: text('processing_time').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const cashierSettings = pgTable('cashier_settings', {
  id: integer('id').primaryKey(),
  dailyDepositLimit: money('daily_deposit_limit').notNull(),
  monthlyDepositLimit: money('monthly_deposit_limit').notNull(),
  depositExpiryMinutes: integer('deposit_expiry_minutes').notNull(),
  dailyWithdrawalLimit: money('daily_withdrawal_limit').notNull(),
  monthlyWithdrawalLimit: money('monthly_withdrawal_limit').notNull(),
  withdrawalCooldownMinutes: integer('withdrawal_cooldown_minutes').notNull(),
  reviewThreshold: money('review_threshold').notNull(),
  dualApprovalThreshold: money('dual_approval_threshold').notNull(),
  kycRequiredForWithdrawal: boolean('kyc_required_for_withdrawal').notNull(),
  closedLoop: boolean('closed_loop').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

export type DepositStatus = 'CREATED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'UNDER_REVIEW';
export type WithdrawalStatus = 'REQUESTED' | 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'FAILED';

export const deposits = pgTable('deposits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  methodId: text('method_id')
    .notNull()
    .references(() => paymentMethods.id),
  provider: text('provider').notNull(),
  sandbox: boolean('sandbox').notNull(),
  amount: money('amount').notNull(),
  fee: money('fee').notNull(),
  credited: money('credited').notNull(),
  currency: text('currency').notNull(),
  status: text('status').$type<DepositStatus>().notNull(),
  providerReference: text('provider_reference').unique(),
  idempotencyKey: text('idempotency_key').notNull(),
  bonusCampaignId: bigint('bonus_campaign_id', { mode: 'number' }).references(() => bonusCampaigns.id),
  failureReason: text('failure_reason'),
  ledgerTxId: bigint('ledger_tx_id', { mode: 'number' })
    .unique()
    .references(() => ledgerTransactions.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  completedAt: ts('completed_at'),
  expiresAt: ts('expires_at').notNull(),
});

export const withdrawals = pgTable('withdrawals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  methodId: text('method_id')
    .notNull()
    .references(() => paymentMethods.id),
  provider: text('provider').notNull(),
  sandbox: boolean('sandbox').notNull(),
  amount: money('amount').notNull(),
  fee: money('fee').notNull(),
  payout: money('payout').notNull(),
  currency: text('currency').notNull(),
  status: text('status').$type<WithdrawalStatus>().notNull(),
  providerReference: text('provider_reference').unique(),
  idempotencyKey: text('idempotency_key').notNull(),
  holdTxId: bigint('hold_tx_id', { mode: 'number' })
    .notNull()
    .unique()
    .references(() => ledgerTransactions.id),
  closeTxId: bigint('close_tx_id', { mode: 'number' })
    .unique()
    .references(() => ledgerTransactions.id),
  firstApprovedBy: uuid('first_approved_by').references(() => users.id),
  firstApprovedAt: ts('first_approved_at'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  reviewNote: text('review_note'),
  failureReason: text('failure_reason'),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  completedAt: ts('completed_at'),
});

export const paymentEvents = pgTable('payment_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  provider: text('provider').notNull(),
  eventId: text('event_id'),
  eventType: text('event_type'),
  signatureValid: boolean('signature_valid').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  result: text('result').notNull(),
  depositId: uuid('deposit_id').references(() => deposits.id),
  withdrawalId: uuid('withdrawal_id').references(() => withdrawals.id),
  receivedAt: ts('received_at').notNull().defaultNow(),
});

export type NotificationKind = 'deposit' | 'withdrawal' | 'bonus' | 'vip' | 'security' | 'verification' | 'support' | 'system';

export const notifications = pgTable('notifications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  kind: text('kind').$type<NotificationKind>().notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  readAt: ts('read_at'),
  emailStatus: text('email_status').$type<'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'>(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type KycDocumentKind = 'ID_FRONT' | 'ID_BACK' | 'PROOF_OF_ADDRESS' | 'SELFIE' | 'OTHER';
export type UploadContentType = 'image/jpeg' | 'image/png' | 'application/pdf';

export const kycDocuments = pgTable('kyc_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  kind: text('kind').$type<KycDocumentKind>().notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').$type<UploadContentType>().notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  status: text('status').$type<'PENDING' | 'ACCEPTED' | 'REJECTED'>().notNull().default('PENDING'),
  reviewNote: text('review_note'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  uploadedAt: ts('uploaded_at').notNull().defaultNow(),
});

export const kycReviews = pgTable('kyc_reviews', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  decision: text('decision').$type<'SUBMITTED' | 'VERIFIED' | 'REJECTED'>().notNull(),
  note: text('note'),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type RiskFlagKind = 'DOCUMENT_MISMATCH' | 'MULTIPLE_ACCOUNTS' | 'PAYMENT_CHARGEBACK' | 'BONUS_ABUSE' | 'SOURCE_OF_FUNDS' | 'OTHER';

export const riskFlags = pgTable('risk_flags', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  kind: text('kind').$type<RiskFlagKind>().notNull(),
  severity: text('severity').$type<'LOW' | 'MEDIUM' | 'HIGH'>().notNull(),
  note: text('note').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: ts('resolved_at'),
  resolution: text('resolution'),
});

export type TicketCategory = 'ACCOUNT' | 'PAYMENTS' | 'VERIFICATION' | 'BONUSES' | 'GAMES' | 'RESPONSIBLE_PLAY' | 'OTHER';
export type TicketStatus = 'OPEN' | 'AWAITING_PLAYER' | 'RESOLVED' | 'CLOSED';

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  category: text('category').$type<TicketCategory>().notNull(),
  subject: text('subject').notNull(),
  status: text('status').$type<TicketStatus>().notNull().default('OPEN'),
  priority: text('priority').$type<'NORMAL' | 'HIGH'>().notNull().default('NORMAL'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  closedAt: ts('closed_at'),
});

export const supportMessages = pgTable('support_messages', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => supportTickets.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  fromStaff: boolean('from_staff').notNull(),
  internal: boolean('internal').notNull().default(false),
  body: text('body').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const supportAttachments = pgTable('support_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => supportTickets.id),
  messageId: bigint('message_id', { mode: 'number' })
    .notNull()
    .references(() => supportMessages.id),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').$type<UploadContentType>().notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const vipTiers = pgTable('vip_tiers', {
  level: integer('level').primaryKey(),
  name: text('name').notNull(),
  minWagered: money('min_wagered').notNull(),
  topUpBonusPct: integer('top_up_bonus_pct').notNull().default(0),
  prioritySupport: boolean('priority_support').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
