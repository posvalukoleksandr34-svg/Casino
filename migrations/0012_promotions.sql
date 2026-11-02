-- 0012: promotional campaigns (welcome offers, promo codes) with wagering
-- requirements, on the existing double-entry ledger.
--
-- Virtual credits only. A claimed bonus is held in one system account,
-- BONUS_LOCKED, until its wagering requirement is met (then it moves to the
-- player's wallet), it expires, or the player forfeits it (then it returns to
-- PROMOTIONS). Each player still has exactly one wallet: locked bonus credits
-- are never spendable and are not a second balance. Reconciliation checks
-- that BONUS_LOCKED equals the sum of active claims.
--
-- Transactions: BONUS_CLAIMED (promotions → locked), BONUS_RELEASED (locked →
-- wallet), BONUS_FORFEITED (locked → promotions).
--
-- Additive only: four enum values, two tables, guard triggers.

ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'BONUS_LOCKED';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'BONUS_CLAIMED';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'BONUS_RELEASED';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'BONUS_FORFEITED';

CREATE TABLE bonus_campaigns (
  id                         bigserial PRIMARY KEY,
  slug                       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  kind                       text NOT NULL CHECK (kind IN ('WELCOME', 'PROMO_CODE')),
  -- Promo codes are stored upper-case; welcome offers have none.
  code                       text UNIQUE CHECK (code IS NULL OR code ~ '^[A-Z0-9]{4,20}$'),
  name                       text NOT NULL CHECK (length(name) BETWEEN 3 AND 80),
  description                text NOT NULL CHECK (length(description) BETWEEN 3 AND 400),
  -- Amount = fixed_amount + match_percent % of the player's starting credits, capped at max_bonus.
  match_percent              integer NOT NULL DEFAULT 0 CHECK (match_percent BETWEEN 0 AND 200),
  fixed_amount               bigint NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
  max_bonus                  bigint NOT NULL CHECK (max_bonus > 0 AND max_bonus <= 10000000),
  -- Credits to wager = multiplier × bonus amount before release (0 = released at once).
  wagering_multiplier        integer NOT NULL CHECK (wagering_multiplier BETWEEN 0 AND 20),
  expires_after_days         integer NOT NULL CHECK (expires_after_days BETWEEN 1 AND 90),
  -- Only accounts at most this many days old may claim (NULL = any age).
  eligible_account_age_days  integer CHECK (eligible_account_age_days IS NULL OR eligible_account_age_days > 0),
  starts_at                  timestamptz NOT NULL DEFAULT now(),
  ends_at                    timestamptz,
  max_claims                 integer CHECK (max_claims IS NULL OR max_claims > 0),
  active                     boolean NOT NULL DEFAULT true,
  created_by                 uuid REFERENCES users (id),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'PROMO_CODE' OR code IS NOT NULL),
  CHECK (kind <> 'WELCOME' OR code IS NULL),
  CHECK (match_percent > 0 OR fixed_amount > 0),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE bonus_claims (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users (id),
  campaign_id        bigint NOT NULL REFERENCES bonus_campaigns (id),
  amount             bigint NOT NULL CHECK (amount > 0),
  wagering_required  bigint NOT NULL CHECK (wagering_required >= 0),
  wagering_progress  bigint NOT NULL DEFAULT 0 CHECK (wagering_progress >= 0),
  status             text NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'EXPIRED', 'FORFEITED')),
  expires_at         timestamptz NOT NULL,
  claimed_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  grant_tx_id        bigint NOT NULL UNIQUE REFERENCES ledger_transactions (id),
  close_tx_id        bigint UNIQUE REFERENCES ledger_transactions (id),
  -- Each campaign once per player, ever.
  UNIQUE (user_id, campaign_id),
  CHECK ((status = 'ACTIVE') = (closed_at IS NULL)),
  CHECK ((status = 'ACTIVE') = (close_tx_id IS NULL))
);
-- At most one bonus in progress per player (wagering is attributed unambiguously).
CREATE UNIQUE INDEX bonus_claims_one_active ON bonus_claims (user_id) WHERE status = 'ACTIVE';
CREATE INDEX bonus_claims_expiry ON bonus_claims (expires_at) WHERE status = 'ACTIVE';
CREATE INDEX bonus_claims_campaign ON bonus_claims (campaign_id);

-- A claim's terms are fixed when it is made; progress only grows; a closed claim never reopens.
CREATE OR REPLACE FUNCTION bonus_claims_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bonus claims cannot be deleted';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.campaign_id <> OLD.campaign_id OR NEW.amount <> OLD.amount
     OR NEW.wagering_required <> OLD.wagering_required OR NEW.grant_tx_id <> OLD.grant_tx_id
     OR NEW.claimed_at <> OLD.claimed_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'bonus claim terms are immutable';
  END IF;
  IF NEW.wagering_progress < OLD.wagering_progress THEN
    RAISE EXCEPTION 'wagering progress cannot decrease';
  END IF;
  IF OLD.status <> 'ACTIVE' AND (NEW.status <> OLD.status OR NEW.wagering_progress <> OLD.wagering_progress
     OR NEW.close_tx_id IS DISTINCT FROM OLD.close_tx_id OR NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
    RAISE EXCEPTION 'a closed bonus claim cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bonus_claims_guard BEFORE UPDATE OR DELETE ON bonus_claims
  FOR EACH ROW EXECUTE FUNCTION bonus_claims_guard();
-- Its own function, not forbid_mutation(): that marks a table append-only for the app role,
-- and claims must stay updatable (progress, closing).
CREATE OR REPLACE FUNCTION bonus_claims_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bonus claims cannot be truncated';
END;
$$;
CREATE TRIGGER bonus_claims_no_truncate BEFORE TRUNCATE ON bonus_claims
  FOR EACH STATEMENT EXECUTE FUNCTION bonus_claims_no_truncate();

SELECT casino_apply_app_grants();
