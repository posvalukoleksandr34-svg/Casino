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
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const userRole = pgEnum('user_role', ['PLAYER', 'SUPPORT', 'RISK_MANAGER', 'AUDITOR', 'ADMIN', 'OWNER']);
export const userStatus = pgEnum('user_status', ['ACTIVE', 'SUSPENDED', 'DELETED']);
export const accountType = pgEnum('account_type', [
  'PLAYER_WALLET',
  'HOUSE_BANKROLL',
  'WAGERS_IN_PLAY',
  'SPORTS_IN_PLAY',
  'PROMOTIONS',
  'ADJUSTMENTS',
  'ISSUANCE',
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
