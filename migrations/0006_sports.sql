-- Sports prediction simulator (virtual chips only).
--
-- Money: tickets move stakes into a dedicated escrow account (SPORTS_IN_PLAY)
-- and settle, void or correct through their own ledger transaction types, each
-- linked to the ticket (ledger_transactions.sports_ticket_id). Every wallet
-- change is a balanced ledger transaction with a unique business key, so it
-- happens at most once.
--
-- Results: sports_result_log records every result, void and correction of an
-- event (append-only, versioned). sports_settlements records, per ticket and
-- result version, the outcome, the entitlement under that version and the
-- amount actually credited (append-only). Corrections only ever credit: a
-- player is never debited after settlement (docs/sports.md, correction policy).
--
-- Demo events carry a committed seed (hash published before betting, seed
-- revealed at settlement) and the published score model the result is drawn
-- from.

ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'SPORTS_IN_PLAY';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'SPORTS_STAKE';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'SPORTS_SETTLED';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'SPORTS_VOIDED';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'SPORTS_CORRECTION';

CREATE TYPE sports_event_status AS ENUM ('SCHEDULED', 'LIVE', 'SUSPENDED', 'FINISHED', 'POSTPONED', 'CANCELLED');
CREATE TYPE sports_market_status AS ENUM ('OPEN', 'SUSPENDED', 'CLOSED', 'SETTLED', 'VOIDED');
CREATE TYPE sports_ticket_status AS ENUM ('ACCEPTED', 'SUSPENDED', 'WON', 'LOST', 'VOIDED', 'REJECTED');

CREATE TABLE sports_competitions (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  country    text,
  source     text        NOT NULL,
  is_demo    boolean     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sports_teams (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  short_name text,
  source     text        NOT NULL,
  is_demo    boolean     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sports_events (
  id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text                NOT NULL,
  external_id         text                NOT NULL,
  competition_id      text                NOT NULL REFERENCES sports_competitions(id),
  home_team_id        text                NOT NULL REFERENCES sports_teams(id),
  away_team_id        text                NOT NULL REFERENCES sports_teams(id),
  kickoff_at          timestamptz         NOT NULL,
  status              sports_event_status NOT NULL DEFAULT 'SCHEDULED',
  is_demo             boolean             NOT NULL,
  home_score          integer             CHECK (home_score >= 0),
  away_score          integer             CHECK (away_score >= 0),
  result_version      integer             NOT NULL DEFAULT 0 CHECK (result_version >= 0),
  result_source       text,
  result_at           timestamptz,
  seed_hash           text,
  seed_enc            text,
  revealed_seed       text,
  model               jsonb,
  provider_updated_at timestamptz,
  created_at          timestamptz         NOT NULL DEFAULT now(),
  updated_at          timestamptz         NOT NULL DEFAULT now(),
  UNIQUE (source, external_id),
  CHECK (away_team_id <> home_team_id),
  CHECK ((home_score IS NULL) = (away_score IS NULL)),
  CHECK (NOT is_demo OR (seed_hash IS NOT NULL AND seed_enc IS NOT NULL AND model IS NOT NULL)),
  CHECK (revealed_seed IS NULL OR is_demo)
);
CREATE INDEX sports_events_kickoff_idx ON sports_events (kickoff_at);
CREATE INDEX sports_events_status_idx ON sports_events (status, kickoff_at);

-- Odds-provider ids mapped onto events (fixtures and odds may come from different providers).
CREATE TABLE sports_external_refs (
  provider    text        NOT NULL,
  external_id text        NOT NULL,
  event_id    uuid        NOT NULL REFERENCES sports_events(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_id)
);

CREATE TABLE sports_markets (
  id              bigserial            PRIMARY KEY,
  event_id        uuid                 NOT NULL REFERENCES sports_events(id),
  type            text                 NOT NULL CHECK (type IN ('1X2')),
  status          sports_market_status NOT NULL DEFAULT 'OPEN',
  odds_source     text                 NOT NULL,
  odds_updated_at timestamptz          NOT NULL,
  version         integer              NOT NULL DEFAULT 1 CHECK (version >= 1),
  status_reason   text,
  created_at      timestamptz          NOT NULL DEFAULT now(),
  updated_at      timestamptz          NOT NULL DEFAULT now(),
  UNIQUE (event_id, type)
);

-- odds_e2: decimal odds x 100 (215 = 2.15). NULL = not offered.
CREATE TABLE sports_selections (
  id        bigserial PRIMARY KEY,
  market_id bigint    NOT NULL REFERENCES sports_markets(id),
  code      text      NOT NULL CHECK (code IN ('HOME', 'DRAW', 'AWAY')),
  odds_e2   integer   CHECK (odds_e2 IS NULL OR odds_e2 BETWEEN 101 AND 100000),
  UNIQUE (market_id, code)
);

CREATE TABLE sports_odds_history (
  id             bigserial   PRIMARY KEY,
  selection_id   bigint      NOT NULL REFERENCES sports_selections(id),
  market_version integer     NOT NULL,
  odds_e2        integer,
  source         text        NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sports_odds_history_selection_idx ON sports_odds_history (selection_id, recorded_at);

CREATE TABLE sports_tickets (
  id                 uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid                 NOT NULL REFERENCES users(id),
  slip_id            uuid                 NOT NULL,
  idempotency_key    text                 NOT NULL,
  leg                integer              NOT NULL CHECK (leg >= 0),
  event_id           uuid                 NOT NULL REFERENCES sports_events(id),
  market_id          bigint               NOT NULL REFERENCES sports_markets(id),
  selection_id       bigint               NOT NULL REFERENCES sports_selections(id),
  selection_code     text                 NOT NULL CHECK (selection_code IN ('HOME', 'DRAW', 'AWAY')),
  market_version     integer              NOT NULL,
  stake              bigint               NOT NULL CHECK (stake > 0),
  odds_e2            integer              NOT NULL CHECK (odds_e2 BETWEEN 101 AND 100000),
  potential_return   bigint               NOT NULL CHECK (potential_return >= stake),
  status             sports_ticket_status NOT NULL,
  reject_reason      text,
  payout             bigint               CHECK (payout >= 0),
  settlement_source  text,
  settlement_version integer,
  is_demo            boolean              NOT NULL,
  placed_at          timestamptz          NOT NULL DEFAULT now(),
  settled_at         timestamptz,
  updated_at         timestamptz          NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key, leg),
  CHECK ((status = 'REJECTED') = (reject_reason IS NOT NULL)),
  CHECK ((status IN ('ACCEPTED', 'SUSPENDED', 'REJECTED')) = (payout IS NULL)),
  CHECK (payout IS NULL OR payout <= potential_return)
);
CREATE INDEX sports_tickets_user_idx ON sports_tickets (user_id, placed_at DESC);
CREATE INDEX sports_tickets_event_idx ON sports_tickets (event_id, status);
CREATE INDEX sports_tickets_open_idx ON sports_tickets (status) WHERE status IN ('ACCEPTED', 'SUSPENDED');

ALTER TABLE ledger_transactions ADD COLUMN sports_ticket_id uuid REFERENCES sports_tickets(id);
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_one_subject CHECK (round_id IS NULL OR sports_ticket_id IS NULL);
CREATE INDEX ledger_transactions_sports_ticket_idx ON ledger_transactions (sports_ticket_id) WHERE sports_ticket_id IS NOT NULL;

CREATE TABLE sports_result_log (
  id          bigserial   PRIMARY KEY,
  event_id    uuid        NOT NULL REFERENCES sports_events(id),
  version     integer     NOT NULL CHECK (version >= 1),
  kind        text        NOT NULL CHECK (kind IN ('RESULT', 'VOID', 'CORRECTION')),
  home_score  integer,
  away_score  integer,
  reason      text        NOT NULL,
  source      text        NOT NULL,
  actor_id    uuid        REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, version),
  CHECK ((kind = 'VOID') = (home_score IS NULL)),
  CHECK ((home_score IS NULL) = (away_score IS NULL))
);

CREATE TABLE sports_settlements (
  id                    bigserial   PRIMARY KEY,
  ticket_id             uuid        NOT NULL REFERENCES sports_tickets(id),
  version               integer     NOT NULL CHECK (version >= 1),
  outcome               text        NOT NULL CHECK (outcome IN ('WON', 'LOST', 'VOIDED')),
  entitlement           bigint      NOT NULL CHECK (entitlement >= 0),
  credited              bigint      NOT NULL CHECK (credited >= 0),
  ledger_transaction_id bigint      REFERENCES ledger_transactions(id),
  source                text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, version)
);

CREATE TABLE user_sports_favorites (
  user_id    uuid        NOT NULL REFERENCES users(id),
  kind       text        NOT NULL CHECK (kind IN ('team', 'competition')),
  ref_id     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref_id)
);

-- Provider health for operators: last success/error per provider (no secrets stored).
CREATE TABLE sports_provider_status (
  provider           text        PRIMARY KEY,
  last_success_at    timestamptz,
  last_error_at      timestamptz,
  last_error         text,
  requests_remaining integer,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER sports_odds_history_append_only BEFORE UPDATE OR DELETE ON sports_odds_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sports_odds_history_no_truncate BEFORE TRUNCATE ON sports_odds_history
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sports_result_log_append_only BEFORE UPDATE OR DELETE ON sports_result_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sports_result_log_no_truncate BEFORE TRUNCATE ON sports_result_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sports_settlements_append_only BEFORE UPDATE OR DELETE ON sports_settlements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sports_settlements_no_truncate BEFORE TRUNCATE ON sports_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Open sports liability (potential return − stake of unsettled tickets) now
-- counts toward the platform's total exposure for every wager.
CREATE OR REPLACE FUNCTION risk_snapshot(p_game_id text, p_exclude_round uuid)
RETURNS TABLE (house_balance bigint, exposure_game bigint, exposure_total bigint)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_balance bigint;
  v_sports bigint;
BEGIN
  SELECT a.balance INTO v_balance FROM ledger_accounts a WHERE a.code = 'SYSTEM:HOUSE_BANKROLL' FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'house bankroll account missing';
  END IF;
  SELECT coalesce(sum(t.potential_return - t.stake), 0)::bigint INTO v_sports
    FROM sports_tickets t WHERE t.status IN ('ACCEPTED', 'SUSPENDED');
  RETURN QUERY
    SELECT v_balance,
           coalesce(sum(greatest(r.max_payout - r.stake_total, 0)) FILTER (WHERE r.game_id = p_game_id), 0)::bigint,
           (coalesce(sum(greatest(r.max_payout - r.stake_total, 0)), 0) + v_sports)::bigint
    FROM game_rounds r
    WHERE r.status = 'OPEN' AND (p_exclude_round IS NULL OR r.id <> p_exclude_round);
END;
$$;

-- Same lock and snapshot for a sports placement: liability on one event and in total.
CREATE FUNCTION sports_risk_snapshot(p_event_id uuid)
RETURNS TABLE (house_balance bigint, exposure_event bigint, exposure_total bigint)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_balance bigint;
  v_games bigint;
BEGIN
  SELECT a.balance INTO v_balance FROM ledger_accounts a WHERE a.code = 'SYSTEM:HOUSE_BANKROLL' FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'house bankroll account missing';
  END IF;
  SELECT coalesce(sum(greatest(r.max_payout - r.stake_total, 0)), 0)::bigint INTO v_games
    FROM game_rounds r WHERE r.status = 'OPEN';
  RETURN QUERY
    SELECT v_balance,
           coalesce(sum(t.potential_return - t.stake) FILTER (WHERE t.event_id = p_event_id), 0)::bigint,
           (coalesce(sum(t.potential_return - t.stake), 0) + v_games)::bigint
    FROM sports_tickets t
    WHERE t.status IN ('ACCEPTED', 'SUSPENDED');
END;
$$;

CREATE OR REPLACE FUNCTION casino_apply_app_grants() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t record;
  prunable text[] := ARRAY['idempotency_keys', 'rate_limit_buckets', 'sessions', 'user_favorites', 'user_sports_favorites'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'casino_app') THEN
    RETURN;
  END IF;
  EXECUTE 'GRANT USAGE ON SCHEMA public TO casino_app';
  FOR t IN
    SELECT c.relname,
           EXISTS (
             SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
             WHERE tg.tgrelid = c.oid AND p.proname = 'forbid_mutation'
           ) AS append_only
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM casino_app', t.relname);
    IF t.relname = 'schema_migrations' THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO casino_app', t.relname);
    ELSIF t.append_only THEN
      EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO casino_app', t.relname);
    ELSIF t.relname = ANY (prunable) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO casino_app', t.relname);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO casino_app', t.relname);
    END IF;
  END LOOP;
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO casino_app', t.relname);
  END LOOP;
END;
$$;

SELECT casino_apply_app_grants();
