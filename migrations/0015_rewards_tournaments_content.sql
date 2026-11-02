-- 0015: player rewards (cashback, birthday, VIP level-up, tournament prizes),
-- VIP cashback and level history, tournaments, site announcements, staff
-- notes on players, an "in progress" support status, system-raised risk flags
-- and "remember me" sessions.
--
-- Rewards are wager-free credits: claiming one posts REWARD_CREDITED
-- (promotions → the player's wallet) once, checked by reconciliation.
-- Virtual credits only, like every other balance in this code base.

ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'REWARD_CREDITED';

-- VIP ------------------------------------------------------------------------
-- Weekly cashback in basis points of the previous week's net casino losses, and a
-- one-off reward when a player first reaches the tier.
ALTER TABLE vip_tiers ADD COLUMN cashback_bp integer NOT NULL DEFAULT 0 CHECK (cashback_bp BETWEEN 0 AND 2000);
ALTER TABLE vip_tiers ADD COLUMN level_up_reward bigint NOT NULL DEFAULT 0 CHECK (level_up_reward >= 0 AND level_up_reward <= 10000000);
UPDATE vip_tiers SET cashback_bp = CASE level WHEN 2 THEN 200 WHEN 3 THEN 500 WHEN 4 THEN 700 WHEN 5 THEN 1000 WHEN 6 THEN 1200 ELSE 0 END,
                     level_up_reward = CASE level WHEN 2 THEN 10000 WHEN 3 THEN 50000 WHEN 4 THEN 200000 WHEN 5 THEN 1000000 WHEN 6 THEN 2500000 ELSE 0 END;

CREATE TABLE vip_level_history (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id),
  from_level  integer NOT NULL,
  to_level    integer NOT NULL CHECK (to_level > from_level),
  wagered     bigint NOT NULL CHECK (wagered >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vip_level_history_user_idx ON vip_level_history (user_id, id DESC);
CREATE TRIGGER vip_level_history_append_only BEFORE UPDATE OR DELETE ON vip_level_history FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER vip_level_history_no_truncate BEFORE TRUNCATE ON vip_level_history FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Rewards --------------------------------------------------------------------
CREATE TABLE reward_settings (
  id                   integer PRIMARY KEY CHECK (id = 1),
  birthday_amount      bigint NOT NULL CHECK (birthday_amount >= 0 AND birthday_amount <= 10000000),
  -- Cashback below this net loss is not offered; above cashback_max it is capped.
  cashback_min_loss    bigint NOT NULL CHECK (cashback_min_loss >= 0),
  cashback_max         bigint NOT NULL CHECK (cashback_max > 0 AND cashback_max <= 10000000),
  reward_expiry_days   integer NOT NULL CHECK (reward_expiry_days BETWEEN 1 AND 90),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users (id)
);

CREATE TABLE player_rewards (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id),
  kind           text NOT NULL CHECK (kind IN ('CASHBACK', 'BIRTHDAY', 'LEVEL_UP', 'TOURNAMENT')),
  -- What the reward is for (a week, a year, a level, a tournament); one reward per kind and period.
  period_key     text NOT NULL CHECK (length(period_key) BETWEEN 1 AND 60),
  amount         bigint NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  description    text NOT NULL CHECK (length(description) BETWEEN 3 AND 200),
  status         text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'CLAIMED', 'EXPIRED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  claimed_at     timestamptz,
  ledger_tx_id   bigint UNIQUE REFERENCES ledger_transactions (id),
  UNIQUE (user_id, kind, period_key),
  CHECK ((status = 'CLAIMED') = (ledger_tx_id IS NOT NULL) AND (status = 'CLAIMED') = (claimed_at IS NOT NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX player_rewards_user_idx ON player_rewards (user_id, created_at DESC);
CREATE INDEX player_rewards_due_idx ON player_rewards (expires_at) WHERE status = 'AVAILABLE';

CREATE OR REPLACE FUNCTION player_rewards_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rewards cannot be deleted';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.kind <> OLD.kind OR NEW.period_key <> OLD.period_key OR NEW.amount <> OLD.amount THEN
    RAISE EXCEPTION 'reward terms are immutable';
  END IF;
  IF OLD.status <> 'AVAILABLE' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'a claimed or expired reward is final';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER player_rewards_guard BEFORE UPDATE OR DELETE ON player_rewards FOR EACH ROW EXECUTE FUNCTION player_rewards_guard();
CREATE OR REPLACE FUNCTION player_rewards_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rewards cannot be truncated';
END;
$$;
CREATE TRIGGER player_rewards_no_truncate BEFORE TRUNCATE ON player_rewards FOR EACH STATEMENT EXECUTE FUNCTION player_rewards_no_truncate();

-- Tournaments ----------------------------------------------------------------
-- Scored only from settled rounds after the player joined, inside the window.
-- Metrics rank luck, not volume: the best single-round multiple, or the sum of
-- a player's three best multiples (stakes of at least min_stake).
CREATE TABLE tournaments (
  id              bigserial PRIMARY KEY,
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name            text NOT NULL CHECK (length(name) BETWEEN 3 AND 80),
  description     text NOT NULL CHECK (length(description) BETWEEN 3 AND 600),
  game_ids        text[] NOT NULL DEFAULT '{}',
  metric          text NOT NULL CHECK (metric IN ('BEST_MULTIPLIER', 'TOP3_MULTIPLIERS')),
  min_stake       bigint NOT NULL CHECK (min_stake > 0),
  min_vip_level   integer NOT NULL DEFAULT 1 CHECK (min_vip_level BETWEEN 1 AND 10),
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  -- Prize per rank, in minor units: prizes[1] for first place, …
  prizes          bigint[] NOT NULL CHECK (cardinality(prizes) BETWEEN 1 AND 50),
  status          text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'FINISHED', 'CANCELLED')),
  finalized_at    timestamptz,
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((status = 'FINISHED') = (finalized_at IS NOT NULL))
);
CREATE INDEX tournaments_window_idx ON tournaments (ends_at) WHERE status = 'SCHEDULED';

CREATE TABLE tournament_entries (
  tournament_id  bigint NOT NULL REFERENCES tournaments (id),
  user_id        uuid NOT NULL REFERENCES users (id),
  joined_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX tournament_entries_user_idx ON tournament_entries (user_id);
CREATE TRIGGER tournament_entries_append_only BEFORE UPDATE OR DELETE ON tournament_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tournament_entries_no_truncate BEFORE TRUNCATE ON tournament_entries FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TABLE tournament_results (
  tournament_id  bigint NOT NULL REFERENCES tournaments (id),
  user_id        uuid NOT NULL REFERENCES users (id),
  rank           integer NOT NULL CHECK (rank > 0),
  score          bigint NOT NULL CHECK (score >= 0),
  prize          bigint NOT NULL CHECK (prize >= 0),
  reward_id      bigint UNIQUE REFERENCES player_rewards (id),
  PRIMARY KEY (tournament_id, user_id),
  UNIQUE (tournament_id, rank),
  CHECK ((prize > 0) = (reward_id IS NOT NULL))
);
CREATE TRIGGER tournament_results_append_only BEFORE UPDATE OR DELETE ON tournament_results FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tournament_results_no_truncate BEFORE TRUNCATE ON tournament_results FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Content --------------------------------------------------------------------
CREATE TABLE site_announcements (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 80),
  body        text NOT NULL CHECK (length(body) BETWEEN 3 AND 300),
  link        text CHECK (link IS NULL OR link ~ '^/[A-Za-z0-9/_?=&#.-]*$'),
  tone        text NOT NULL CHECK (tone IN ('info', 'promo', 'warning')),
  placement   text NOT NULL CHECK (placement IN ('HOME', 'LOBBY', 'ALL')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

-- Staff notes on a player (append-only; never shown to the player).
CREATE TABLE user_notes (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id),
  author_id   uuid NOT NULL REFERENCES users (id),
  body        text NOT NULL CHECK (length(body) BETWEEN 3 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (author_id <> user_id)
);
CREATE INDEX user_notes_user_idx ON user_notes (user_id, id DESC);
CREATE TRIGGER user_notes_append_only BEFORE UPDATE OR DELETE ON user_notes FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER user_notes_no_truncate BEFORE TRUNCATE ON user_notes FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Support: an explicit "in progress" status ------------------------------------
ALTER TABLE support_tickets DROP CONSTRAINT support_tickets_status_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_check CHECK (status IN ('OPEN', 'IN_PROGRESS', 'AWAITING_PLAYER', 'RESOLVED', 'CLOSED'));
DROP INDEX support_tickets_queue_idx;
CREATE INDEX support_tickets_queue_idx ON support_tickets (priority DESC, updated_at) WHERE status IN ('OPEN', 'IN_PROGRESS', 'AWAITING_PLAYER');

-- Risk flags raised by the system (e.g. several accounts from one address) have no staff author.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'risk_flags'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%created_by <> user_id%' LOOP
    EXECUTE format('ALTER TABLE risk_flags DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE risk_flags ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE risk_flags ADD CONSTRAINT risk_flags_not_self CHECK (created_by IS NULL OR created_by <> user_id);

-- "Remember me": a longer-lived session that survives closing the browser.
ALTER TABLE sessions ADD COLUMN remember boolean NOT NULL DEFAULT false;

SELECT casino_apply_app_grants();
