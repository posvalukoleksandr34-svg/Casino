-- =============================================================================
-- 0001_init: core schema for users, double-entry ledger, games, rounds, risk,
-- provably-fair seeds, responsible play, audit and operations.
--
-- Invariants enforced *by the database* (not only by application code):
--   * ledger_entries / ledger_transactions / payouts / bets / bonuses /
--     audit_logs / admin_actions are append-only (UPDATE/DELETE/TRUNCATE fail).
--   * Every ledger transaction balances: SUM(amount) = 0 (deferred check at COMMIT).
--   * Account balances change only through ledger entries (trigger-maintained),
--     so cached balance = SUM(entries) by construction.
--   * Non-negative balances for accounts that do not allow overdraft.
--   * A settled or voided round can never be modified.
--   * A (seed pair, nonce) combination is used by at most one round.
-- =============================================================================

CREATE TYPE user_role AS ENUM ('PLAYER', 'SUPPORT', 'RISK_MANAGER', 'AUDITOR', 'ADMIN');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE account_type AS ENUM ('PLAYER_WALLET', 'HOUSE_BANKROLL', 'WAGERS_IN_PLAY', 'PROMOTIONS', 'ADJUSTMENTS', 'ISSUANCE');
CREATE TYPE ledger_tx_type AS ENUM ('BET_PLACED', 'BET_SETTLED', 'ROUND_VOIDED', 'BONUS_GRANTED', 'ADJUSTMENT', 'HOUSE_FUNDING');
CREATE TYPE game_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');
CREATE TYPE round_status AS ENUM ('OPEN', 'SETTLED', 'VOIDED');
CREATE TYPE seed_status AS ENUM ('ACTIVE', 'REVEALED');

-- ---------------------------------------------------------------------------
-- Generic guards
-- ---------------------------------------------------------------------------
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% not permitted)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ---------------------------------------------------------------------------
-- Users and authentication
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  username            text NOT NULL,
  password_hash       text,
  role                user_role NOT NULL DEFAULT 'PLAYER',
  status              user_status NOT NULL DEFAULT 'ACTIVE',
  status_reason       text,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  preferences         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz,
  deleted_at          timestamptz,
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_.-]{3,32}$'),
  CONSTRAINT users_deleted_has_no_password CHECK (status <> 'DELETED' OR password_hash IS NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id),
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  user_agent    text,
  ip_hash       text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id),
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Games, configuration and risk limits
-- ---------------------------------------------------------------------------
CREATE TABLE games (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  interactive    boolean NOT NULL,
  status         game_status NOT NULL DEFAULT 'DISABLED',
  status_reason  text,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Configurations are versioned and immutable; rounds reference the exact version used.
CREATE TABLE game_configurations (
  id          bigserial PRIMARY KEY,
  game_id     text NOT NULL REFERENCES games (id),
  version     integer NOT NULL,
  config      jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users (id),
  UNIQUE (game_id, version)
);
CREATE UNIQUE INDEX game_configurations_one_active ON game_configurations (game_id) WHERE is_active;

CREATE FUNCTION game_configurations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'game configurations cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.config IS DISTINCT FROM OLD.config OR NEW.game_id <> OLD.game_id OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'game configurations are immutable; create a new version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_configurations_guard BEFORE UPDATE OR DELETE ON game_configurations
  FOR EACH ROW EXECUTE FUNCTION game_configurations_guard();

-- Per-game limits (minor units). NULL max_* means "no limit at this level".
CREATE TABLE risk_limits (
  game_id               text PRIMARY KEY REFERENCES games (id),
  min_stake             bigint NOT NULL CHECK (min_stake > 0),
  max_stake             bigint NOT NULL,
  max_payout_per_round  bigint NOT NULL,
  max_game_exposure     bigint NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES users (id),
  CHECK (max_stake >= min_stake),
  CHECK (max_payout_per_round > 0),
  CHECK (max_game_exposure > 0)
);

-- Singleton row with platform-wide controls.
CREATE TABLE platform_settings (
  id                   integer PRIMARY KEY CHECK (id = 1),
  new_rounds_enabled   boolean NOT NULL DEFAULT true,
  incident_message     text,
  max_total_exposure   bigint NOT NULL CHECK (max_total_exposure > 0),
  min_house_reserve    bigint NOT NULL CHECK (min_house_reserve >= 0),
  max_player_balance   bigint NOT NULL CHECK (max_player_balance > 0),
  signup_bonus         bigint NOT NULL CHECK (signup_bonus >= 0),
  daily_bonus          bigint NOT NULL CHECK (daily_bonus >= 0),
  daily_bonus_max_balance bigint NOT NULL CHECK (daily_bonus_max_balance >= 0),
  anomaly_z_threshold  double precision NOT NULL DEFAULT 4 CHECK (anomaly_z_threshold > 0),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users (id)
);

-- ---------------------------------------------------------------------------
-- Double-entry ledger
-- ---------------------------------------------------------------------------
CREATE TABLE ledger_accounts (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  type            account_type NOT NULL,
  user_id         uuid UNIQUE REFERENCES users (id),
  currency        text NOT NULL DEFAULT 'CHIP',
  balance         bigint NOT NULL DEFAULT 0,
  -- Number of entries posted to this account; also the last entry's account_seq.
  entry_count     bigint NOT NULL DEFAULT 0,
  allow_negative  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_non_negative CHECK (allow_negative OR balance >= 0),
  CONSTRAINT ledger_accounts_wallet_owner CHECK ((type = 'PLAYER_WALLET') = (user_id IS NOT NULL))
);

-- Balances may only change while a ledger entry is being posted.
CREATE FUNCTION ledger_accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger accounts cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.balance IS DISTINCT FROM OLD.balance OR NEW.entry_count IS DISTINCT FROM OLD.entry_count)
     AND coalesce(current_setting('casino.ledger_posting', true), '') <> 'on' THEN
    RAISE EXCEPTION 'account balances can only change through ledger entries' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id <> OLD.id OR NEW.code <> OLD.code OR NEW.type <> OLD.type
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.currency <> OLD.currency
     OR NEW.allow_negative <> OLD.allow_negative THEN
    RAISE EXCEPTION 'ledger account identity is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_accounts_guard BEFORE UPDATE OR DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_accounts_guard();

-- ---------------------------------------------------------------------------
-- Provably-fair seed pairs
-- ---------------------------------------------------------------------------
CREATE TABLE seed_pairs (
  id                    bigserial PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users (id),
  server_seed_enc       text NOT NULL,
  server_seed_hash      text NOT NULL,
  client_seed           text NOT NULL,
  next_nonce            bigint NOT NULL DEFAULT 0 CHECK (next_nonce >= 0),
  status                seed_status NOT NULL DEFAULT 'ACTIVE',
  created_at            timestamptz NOT NULL DEFAULT now(),
  revealed_at           timestamptz,
  revealed_server_seed  text,
  CHECK ((status = 'REVEALED') = (revealed_server_seed IS NOT NULL))
);
CREATE UNIQUE INDEX seed_pairs_one_active ON seed_pairs (user_id) WHERE status = 'ACTIVE';
CREATE INDEX seed_pairs_user_idx ON seed_pairs (user_id, id DESC);

CREATE FUNCTION seed_pairs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'seed pairs cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'REVEALED' THEN
    RAISE EXCEPTION 'revealed seed pairs are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.server_seed_enc <> OLD.server_seed_enc OR NEW.server_seed_hash <> OLD.server_seed_hash
     OR NEW.client_seed <> OLD.client_seed OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'seed commitments are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.next_nonce < OLD.next_nonce THEN
    RAISE EXCEPTION 'nonce can never decrease' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER seed_pairs_guard BEFORE UPDATE OR DELETE ON seed_pairs
  FOR EACH ROW EXECUTE FUNCTION seed_pairs_guard();

-- ---------------------------------------------------------------------------
-- Game rounds and bets
-- ---------------------------------------------------------------------------
CREATE TABLE game_rounds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id),
  game_id           text NOT NULL REFERENCES games (id),
  config_id         bigint NOT NULL REFERENCES game_configurations (id),
  status            round_status NOT NULL DEFAULT 'OPEN',
  seed_pair_id      bigint NOT NULL REFERENCES seed_pairs (id),
  nonce             bigint NOT NULL CHECK (nonce >= 0),
  client_seed       text NOT NULL,
  server_seed_hash  text NOT NULL,
  stake_total       bigint NOT NULL CHECK (stake_total > 0),
  payout_total      bigint CHECK (payout_total >= 0),
  max_payout        bigint NOT NULL CHECK (max_payout >= 0),
  expected_payout   double precision NOT NULL,
  payout_variance   double precision NOT NULL CHECK (payout_variance >= 0),
  state             jsonb NOT NULL,
  action_count      integer NOT NULL DEFAULT 0,
  started_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz,
  void_reason       text,
  UNIQUE (seed_pair_id, nonce),
  CHECK ((status = 'OPEN') = (settled_at IS NULL)),
  CHECK ((status = 'SETTLED') = (payout_total IS NOT NULL))
);
CREATE INDEX game_rounds_user_idx ON game_rounds (user_id, started_at DESC);
CREATE INDEX game_rounds_game_settled_idx ON game_rounds (game_id, settled_at);
CREATE INDEX game_rounds_settled_idx ON game_rounds (settled_at);
CREATE INDEX game_rounds_open_idx ON game_rounds (game_id) WHERE status = 'OPEN';
-- At most one unfinished round per player and game (interactive games).
CREATE UNIQUE INDEX game_rounds_one_open_per_game ON game_rounds (user_id, game_id) WHERE status = 'OPEN';

CREATE FUNCTION game_rounds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'game rounds cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION 'round % is % and can no longer change', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.game_id <> OLD.game_id OR NEW.config_id <> OLD.config_id
     OR NEW.seed_pair_id <> OLD.seed_pair_id OR NEW.nonce <> OLD.nonce OR NEW.client_seed <> OLD.client_seed
     OR NEW.server_seed_hash <> OLD.server_seed_hash OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION 'round identity and fairness inputs are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.stake_total < OLD.stake_total THEN
    RAISE EXCEPTION 'round stake can never decrease' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_rounds_guard BEFORE UPDATE OR DELETE ON game_rounds
  FOR EACH ROW EXECUTE FUNCTION game_rounds_guard();

-- ---------------------------------------------------------------------------
-- Ledger transactions and entries
-- ---------------------------------------------------------------------------
CREATE TABLE ledger_transactions (
  id               bigserial PRIMARY KEY,
  type             ledger_tx_type NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  user_id          uuid REFERENCES users (id),
  round_id         uuid REFERENCES game_rounds (id),
  reverses_id      bigint REFERENCES ledger_transactions (id),
  actor_id         uuid REFERENCES users (id),
  description      text NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_transactions_user_idx ON ledger_transactions (user_id, id DESC);
CREATE INDEX ledger_transactions_round_idx ON ledger_transactions (round_id);
CREATE INDEX ledger_transactions_created_idx ON ledger_transactions (created_at);

CREATE TABLE ledger_entries (
  id              bigserial PRIMARY KEY,
  transaction_id  bigint NOT NULL REFERENCES ledger_transactions (id),
  account_id      bigint NOT NULL REFERENCES ledger_accounts (id),
  amount          bigint NOT NULL CHECK (amount <> 0),
  -- Gapless 1-based position of this entry within its account, assigned while
  -- the account row is locked, so (account_id, account_seq) is the exact
  -- order in which balances changed (entry ids are not, under concurrency).
  account_seq     bigint NOT NULL DEFAULT 0,
  balance_after   bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ledger_entries_account_seq_key ON ledger_entries (account_id, account_seq);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, id);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries (transaction_id);

-- Apply each entry to its account balance atomically and record balance_after.
CREATE FUNCTION ledger_entries_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  new_balance bigint;
  new_seq bigint;
BEGIN
  PERFORM set_config('casino.ledger_posting', 'on', true);
  UPDATE ledger_accounts
     SET balance = balance + NEW.amount, entry_count = entry_count + 1
   WHERE id = NEW.account_id
  RETURNING balance, entry_count INTO new_balance, new_seq;
  PERFORM set_config('casino.ledger_posting', 'off', true);
  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'ledger account % does not exist', NEW.account_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.balance_after := new_balance;
  NEW.account_seq := new_seq;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_entries_apply BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_apply();

-- Every transaction must sum to zero; checked once all entries are in (at COMMIT).
CREATE FUNCTION ledger_transaction_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total numeric;
  n integer;
BEGIN
  SELECT coalesce(sum(amount), 0), count(*) INTO total, n FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (sum = %)', NEW.transaction_id, total USING ERRCODE = 'check_violation';
  END IF;
  IF n < 2 THEN
    RAISE EXCEPTION 'ledger transaction % needs at least two entries', NEW.transaction_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ledger_transaction_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_transaction_balanced();

CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_transactions_no_truncate BEFORE TRUNCATE ON ledger_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TABLE bets (
  id                     bigserial PRIMARY KEY,
  round_id               uuid NOT NULL REFERENCES game_rounds (id),
  user_id                uuid NOT NULL REFERENCES users (id),
  seq                    integer NOT NULL CHECK (seq >= 0),
  kind                   text NOT NULL,
  selection              jsonb NOT NULL DEFAULT '{}'::jsonb,
  stake                  bigint NOT NULL CHECK (stake > 0),
  ledger_transaction_id  bigint NOT NULL REFERENCES ledger_transactions (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, seq)
);
CREATE INDEX bets_user_created_idx ON bets (user_id, created_at);
CREATE INDEX bets_ledger_tx_idx ON bets (ledger_transaction_id);
CREATE TRIGGER bets_append_only BEFORE UPDATE OR DELETE ON bets
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE payouts (
  id                     bigserial PRIMARY KEY,
  round_id               uuid NOT NULL UNIQUE REFERENCES game_rounds (id),
  user_id                uuid NOT NULL REFERENCES users (id),
  amount                 bigint NOT NULL CHECK (amount >= 0),
  ledger_transaction_id  bigint NOT NULL UNIQUE REFERENCES ledger_transactions (id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_user_created_idx ON payouts (user_id, created_at);
CREATE TRIGGER payouts_append_only BEFORE UPDATE OR DELETE ON payouts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Promotions (virtual rewards)
-- ---------------------------------------------------------------------------
CREATE TABLE bonuses (
  id                     bigserial PRIMARY KEY,
  user_id                uuid NOT NULL REFERENCES users (id),
  type                   text NOT NULL CHECK (type IN ('SIGNUP', 'DAILY')),
  claim_key              text NOT NULL UNIQUE,
  amount                 bigint NOT NULL CHECK (amount > 0),
  ledger_transaction_id  bigint NOT NULL UNIQUE REFERENCES ledger_transactions (id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bonuses_user_idx ON bonuses (user_id, created_at DESC);
CREATE INDEX bonuses_created_idx ON bonuses (created_at);
CREATE TRIGGER bonuses_append_only BEFORE UPDATE OR DELETE ON bonuses
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Responsible play
-- ---------------------------------------------------------------------------
CREATE TABLE responsible_limits (
  user_id                uuid PRIMARY KEY REFERENCES users (id),
  daily_loss_limit       bigint CHECK (daily_loss_limit > 0),
  weekly_loss_limit      bigint CHECK (weekly_loss_limit > 0),
  daily_wager_limit      bigint CHECK (daily_wager_limit > 0),
  session_limit_minutes  integer CHECK (session_limit_minutes BETWEEN 5 AND 1440),
  reality_check_minutes  integer CHECK (reality_check_minutes BETWEEN 5 AND 240),
  pending                jsonb,
  pending_effective_at   timestamptz,
  cool_off_until         timestamptz,
  self_excluded_until    timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Idempotency and rate limiting
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  user_id          uuid NOT NULL REFERENCES users (id),
  key              text NOT NULL,
  request_hash     text NOT NULL,
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

CREATE TABLE rate_limit_buckets (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limit_buckets_window_idx ON rate_limit_buckets (window_start);

-- ---------------------------------------------------------------------------
-- Audit and administration
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id             bigserial PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  actor_id       uuid REFERENCES users (id),
  actor_type     text NOT NULL CHECK (actor_type IN ('USER', 'ADMIN', 'SYSTEM', 'ANONYMOUS')),
  action         text NOT NULL,
  resource_type  text,
  resource_id    text,
  before         jsonb,
  after          jsonb,
  reason         text,
  ip_hash        text,
  request_id     text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TABLE admin_actions (
  id             bigserial PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  admin_id       uuid NOT NULL REFERENCES users (id),
  action         text NOT NULL,
  target_type    text NOT NULL,
  target_id      text NOT NULL,
  reason         text NOT NULL CHECK (length(trim(reason)) >= 5),
  before         jsonb,
  after          jsonb,
  audit_log_id   bigint NOT NULL REFERENCES audit_logs (id)
);
CREATE INDEX admin_actions_admin_idx ON admin_actions (admin_id, created_at DESC);
CREATE INDEX admin_actions_target_idx ON admin_actions (target_type, target_id);
CREATE TRIGGER admin_actions_append_only BEFORE UPDATE OR DELETE ON admin_actions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Operations: reconciliation, alerts, error events
-- ---------------------------------------------------------------------------
CREATE TABLE reconciliation_runs (
  id              bigserial PRIMARY KEY,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL CHECK (status IN ('RUNNING', 'OK', 'MISMATCH', 'ERROR')),
  mismatch_count  integer NOT NULL DEFAULT 0,
  checks          jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by    text NOT NULL
);
CREATE INDEX reconciliation_runs_started_idx ON reconciliation_runs (started_at DESC);

CREATE TABLE alerts (
  id               bigserial PRIMARY KEY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  kind             text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  game_id          text REFERENCES games (id),
  message          text NOT NULL,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key       text UNIQUE,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES users (id)
);
CREATE INDEX alerts_open_idx ON alerts (created_at DESC) WHERE acknowledged_at IS NULL;

CREATE TABLE error_events (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  route       text,
  code        text NOT NULL,
  message     text NOT NULL,
  request_id  text
);
CREATE INDEX error_events_created_idx ON error_events (created_at DESC);
