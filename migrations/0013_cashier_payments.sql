-- 0013: cashier — deposits, withdrawals, payment methods, payment events,
-- cashier rules, deposit limits, KYC status and finance/compliance roles.
--
-- LIVE PAYMENTS ARE NOT POSSIBLE WITH THIS CODE BASE: the only payment
-- provider implemented is the sandbox simulator (src/server/payments). A
-- licensed operator must add an authorised provider adapter and enable it
-- explicitly (docs/payments.md).
--
-- Ledger model (one wallet per player, unchanged):
--   deposit settled      PAYMENT_CLEARING −amount → wallet +(amount − fee), PAYMENT_FEES +fee   (DEPOSIT)
--   withdrawal requested wallet −amount → PENDING_WITHDRAWALS +amount                          (WITHDRAWAL_HOLD)
--   payout settled       PENDING_WITHDRAWALS −amount → PAYMENT_CLEARING +(amount − fee), PAYMENT_FEES +fee (WITHDRAWAL_PAID)
--   rejected/cancelled/failed  PENDING_WITHDRAWALS −amount → wallet +amount                   (WITHDRAWAL_RELEASED)
--
-- Additive only.

ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'PENDING_WITHDRAWALS';
ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'PAYMENT_CLEARING';
ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'PAYMENT_FEES';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'DEPOSIT';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'WITHDRAWAL_HOLD';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'WITHDRAWAL_PAID';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'WITHDRAWAL_RELEASED';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'FINANCE_MANAGER';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'COMPLIANCE_MANAGER';

-- Player verification state (the review workflow itself lives in later tables).
ALTER TABLE users ADD COLUMN kyc_status text NOT NULL DEFAULT 'NOT_STARTED'
  CHECK (kyc_status IN ('NOT_STARTED', 'PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'));
ALTER TABLE users ADD COLUMN kyc_updated_at timestamptz;

-- Player-set deposit limits (same lowering-now / raising-after-24h rules as the other limits).
ALTER TABLE responsible_limits ADD COLUMN daily_deposit_limit bigint CHECK (daily_deposit_limit IS NULL OR daily_deposit_limit > 0);
ALTER TABLE responsible_limits ADD COLUMN monthly_deposit_limit bigint CHECK (monthly_deposit_limit IS NULL OR monthly_deposit_limit > 0);

CREATE TABLE payment_methods (
  id                     text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,40}$'),
  name                   text NOT NULL,
  kind                   text NOT NULL CHECK (kind IN ('CARD', 'BANK_TRANSFER', 'E_WALLET')),
  provider               text NOT NULL,
  sandbox                boolean NOT NULL,
  deposit_enabled        boolean NOT NULL DEFAULT true,
  withdrawal_enabled     boolean NOT NULL DEFAULT true,
  min_deposit            bigint NOT NULL CHECK (min_deposit > 0),
  max_deposit            bigint NOT NULL,
  min_withdrawal         bigint NOT NULL CHECK (min_withdrawal > 0),
  max_withdrawal         bigint NOT NULL,
  deposit_fee_fixed      bigint NOT NULL DEFAULT 0 CHECK (deposit_fee_fixed >= 0),
  deposit_fee_bp         integer NOT NULL DEFAULT 0 CHECK (deposit_fee_bp BETWEEN 0 AND 1000),
  withdrawal_fee_fixed   bigint NOT NULL DEFAULT 0 CHECK (withdrawal_fee_fixed >= 0),
  withdrawal_fee_bp      integer NOT NULL DEFAULT 0 CHECK (withdrawal_fee_bp BETWEEN 0 AND 1000),
  processing_time        text NOT NULL,
  sort_order             integer NOT NULL DEFAULT 0,
  active                 boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (max_deposit >= min_deposit),
  CHECK (max_withdrawal >= min_withdrawal)
);

-- One row: platform-wide cashier rules (admin-editable, audited).
CREATE TABLE cashier_settings (
  id                          integer PRIMARY KEY CHECK (id = 1),
  daily_deposit_limit         bigint NOT NULL CHECK (daily_deposit_limit > 0),
  monthly_deposit_limit       bigint NOT NULL CHECK (monthly_deposit_limit > 0),
  deposit_expiry_minutes      integer NOT NULL CHECK (deposit_expiry_minutes BETWEEN 5 AND 1440),
  daily_withdrawal_limit      bigint NOT NULL CHECK (daily_withdrawal_limit > 0),
  monthly_withdrawal_limit    bigint NOT NULL CHECK (monthly_withdrawal_limit > 0),
  withdrawal_cooldown_minutes integer NOT NULL CHECK (withdrawal_cooldown_minutes BETWEEN 0 AND 10080),
  -- Withdrawals of at least this amount wait for a finance review (0 = every withdrawal is reviewed).
  review_threshold            bigint NOT NULL CHECK (review_threshold >= 0),
  -- Reviewed withdrawals of at least this amount need two different approvers (four eyes).
  dual_approval_threshold     bigint NOT NULL CHECK (dual_approval_threshold > 0),
  kyc_required_for_withdrawal boolean NOT NULL,
  -- Withdrawals only to a method the player has completed a deposit with (anti-money-laundering).
  closed_loop                 boolean NOT NULL,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES users (id)
);

CREATE TABLE deposits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users (id),
  method_id          text NOT NULL REFERENCES payment_methods (id),
  provider           text NOT NULL,
  sandbox            boolean NOT NULL,
  amount             bigint NOT NULL CHECK (amount > 0),
  fee                bigint NOT NULL CHECK (fee >= 0),
  credited           bigint NOT NULL CHECK (credited > 0),
  currency           text NOT NULL,
  status             text NOT NULL CHECK (status IN ('CREATED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNDER_REVIEW')),
  provider_reference text UNIQUE,
  idempotency_key    text NOT NULL,
  bonus_campaign_id  bigint REFERENCES bonus_campaigns (id),
  failure_reason     text,
  ledger_tx_id       bigint UNIQUE REFERENCES ledger_transactions (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  expires_at         timestamptz NOT NULL,
  UNIQUE (user_id, idempotency_key),
  CHECK (credited = amount - fee),
  CHECK ((status = 'COMPLETED') = (ledger_tx_id IS NOT NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
CREATE INDEX deposits_user_idx ON deposits (user_id, created_at DESC);
CREATE INDEX deposits_open_idx ON deposits (expires_at) WHERE status IN ('CREATED', 'PENDING', 'PROCESSING');

CREATE TABLE withdrawals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users (id),
  method_id          text NOT NULL REFERENCES payment_methods (id),
  provider           text NOT NULL,
  sandbox            boolean NOT NULL,
  amount             bigint NOT NULL CHECK (amount > 0),
  fee                bigint NOT NULL CHECK (fee >= 0),
  payout             bigint NOT NULL CHECK (payout > 0),
  currency           text NOT NULL,
  status             text NOT NULL CHECK (status IN ('REQUESTED', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED')),
  provider_reference text UNIQUE,
  idempotency_key    text NOT NULL,
  hold_tx_id         bigint NOT NULL UNIQUE REFERENCES ledger_transactions (id),
  close_tx_id        bigint UNIQUE REFERENCES ledger_transactions (id),
  -- First approval of a withdrawal that needs two approvers.
  first_approved_by  uuid REFERENCES users (id),
  first_approved_at  timestamptz,
  reviewed_by        uuid REFERENCES users (id),
  reviewed_at        timestamptz,
  review_note        text,
  failure_reason     text,
  requested_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  UNIQUE (user_id, idempotency_key),
  CHECK (payout = amount - fee),
  CHECK ((status IN ('COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED')) = (close_tx_id IS NOT NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (first_approved_by IS NULL OR reviewed_by IS NULL OR first_approved_by <> reviewed_by),
  CHECK (reviewed_by IS NULL OR reviewed_by <> user_id),
  CHECK (first_approved_by IS NULL OR first_approved_by <> user_id)
);
CREATE INDEX withdrawals_user_idx ON withdrawals (user_id, requested_at DESC);
CREATE INDEX withdrawals_queue_idx ON withdrawals (requested_at) WHERE status IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING');

-- Deposits and withdrawals: money terms never change; a final state is final.
CREATE OR REPLACE FUNCTION cashier_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  final text[] := CASE TG_TABLE_NAME
    WHEN 'deposits' THEN ARRAY['COMPLETED', 'FAILED']
    ELSE ARRAY['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED'] END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.amount <> OLD.amount OR NEW.fee <> OLD.fee OR NEW.method_id <> OLD.method_id
     OR NEW.currency <> OLD.currency OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION '% money terms are immutable', TG_TABLE_NAME;
  END IF;
  IF OLD.status = ANY (final) AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION '% in a final state cannot change', TG_TABLE_NAME;
  END IF;
  -- An expired or abandoned deposit can still be settled late by the provider
  -- (the money did arrive), and nothing else.
  IF TG_TABLE_NAME = 'deposits' AND OLD.status IN ('EXPIRED', 'CANCELLED') AND NEW.status NOT IN (OLD.status, 'COMPLETED') THEN
    RAISE EXCEPTION 'an expired or cancelled deposit can only be completed by a late settlement';
  END IF;
  IF OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
    RAISE EXCEPTION 'a provider reference cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER deposits_guard BEFORE UPDATE OR DELETE ON deposits FOR EACH ROW EXECUTE FUNCTION cashier_payment_guard();
CREATE TRIGGER withdrawals_guard BEFORE UPDATE OR DELETE ON withdrawals FOR EACH ROW EXECUTE FUNCTION cashier_payment_guard();
CREATE OR REPLACE FUNCTION cashier_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cashier records cannot be truncated';
END;
$$;
CREATE TRIGGER deposits_no_truncate BEFORE TRUNCATE ON deposits FOR EACH STATEMENT EXECUTE FUNCTION cashier_no_truncate();
CREATE TRIGGER withdrawals_no_truncate BEFORE TRUNCATE ON withdrawals FOR EACH STATEMENT EXECUTE FUNCTION cashier_no_truncate();

-- Bonus engine: deposit bonuses (first / second / third deposit, reload), game
-- contributions to wagering, and a maximum stake that counts while wagering.
ALTER TABLE bonus_campaigns DROP CONSTRAINT bonus_campaigns_kind_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_kind_check CHECK (kind IN ('WELCOME', 'PROMO_CODE', 'DEPOSIT'));
-- For DEPOSIT campaigns: the qualifying deposit (1 = first, 2 = second …; NULL = any deposit, a reload).
ALTER TABLE bonus_campaigns ADD COLUMN deposit_number integer CHECK (deposit_number IS NULL OR deposit_number BETWEEN 1 AND 10);
ALTER TABLE bonus_campaigns ADD COLUMN min_deposit bigint NOT NULL DEFAULT 0 CHECK (min_deposit >= 0);
-- Stakes above this do not count towards wagering (NULL = no maximum).
ALTER TABLE bonus_campaigns ADD COLUMN max_bet bigint CHECK (max_bet IS NULL OR max_bet > 0);
-- Percent of each stake that counts, by game id; games not listed count default_contribution %.
ALTER TABLE bonus_campaigns ADD COLUMN game_contributions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE bonus_campaigns ADD COLUMN default_contribution integer NOT NULL DEFAULT 100 CHECK (default_contribution BETWEEN 0 AND 100);
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_deposit_terms CHECK (kind = 'DEPOSIT' OR (deposit_number IS NULL AND min_deposit = 0));
-- The deposit a deposit bonus was granted for.
ALTER TABLE bonus_claims ADD COLUMN deposit_id uuid UNIQUE REFERENCES deposits (id);

-- Every webhook delivery, verified or not (append-only): the payment event log.
CREATE TABLE payment_events (
  id               bigserial PRIMARY KEY,
  provider         text NOT NULL,
  event_id         text,
  event_type       text,
  signature_valid  boolean NOT NULL,
  payload          jsonb NOT NULL,
  result           text NOT NULL,
  deposit_id       uuid REFERENCES deposits (id),
  withdrawal_id    uuid REFERENCES withdrawals (id),
  received_at      timestamptz NOT NULL DEFAULT now()
);
-- A verified event is applied once: a replay of the same provider event id is recognised.
CREATE UNIQUE INDEX payment_events_once ON payment_events (provider, event_id) WHERE signature_valid;
CREATE INDEX payment_events_received ON payment_events (received_at DESC);
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER payment_events_no_truncate BEFORE TRUNCATE ON payment_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Player notifications (in-app), with an e-mail outbox column sent by a job after commit.
CREATE TABLE notifications (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id),
  kind          text NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'bonus', 'vip', 'security', 'verification', 'support', 'system')),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 600),
  link          text CHECK (link IS NULL OR link ~ '^/[A-Za-z0-9/_?=&#.-]*$'),
  read_at       timestamptz,
  email_status  text CHECK (email_status IS NULL OR email_status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_outbox_idx ON notifications (created_at) WHERE email_status = 'PENDING';

SELECT casino_apply_app_grants();
