-- Four-eyes approvals, phone verification challenges, age-verification
-- provider fields, and a "rejected" e-mail delivery state. Additive only: no
-- table is dropped and no existing row loses data.
--
-- 1. email_verification_challenges.delivery may be REJECTED: the receiving
--    server refused the address permanently (5xx). FAILED stays "temporary".
-- 2. admin_approval_requests: a sensitive staff operation (large chip grant,
--    ledger correction, house funding, switching off the staff MFA policy)
--    is first requested by one staff member and executed only when a second,
--    different, authorised staff member approves it. The decision and the
--    execution happen in one transaction; a decided request is immutable
--    (trigger), so it cannot be executed twice or re-opened. Requests expire.
-- 3. phone_verification_challenges: SMS codes, stored as keyed HMACs (same
--    design as the e-mail challenges). No SMS provider ships with the
--    application; until an operator configures one, no challenge is created
--    and phone numbers stay unverified.
-- 4. users.age_verified_at / age_verification_provider / age_verification_ref:
--    the result of a third-party age check, when a provider is integrated.
--    NULL means the only age signal is the self-declared date of birth.

-- 1 -------------------------------------------------------------------------
ALTER TABLE email_verification_challenges DROP CONSTRAINT email_verification_challenges_delivery_check;
ALTER TABLE email_verification_challenges ADD CONSTRAINT email_verification_challenges_delivery_check
  CHECK (delivery IN ('PENDING', 'SENT', 'FAILED', 'REJECTED'));

-- 2 -------------------------------------------------------------------------
CREATE TABLE admin_approval_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action         text        NOT NULL CHECK (action IN ('ledger.grant', 'ledger.adjustment', 'house.fund', 'security.staff_mfa_disable')),
  target_type    text        NOT NULL CHECK (target_type IN ('user', 'account', 'platform')),
  target_id      text        NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 100),
  -- The operation's parameters exactly as executed (amount, reverses, …); never a resulting balance.
  params         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reason         text        NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  requested_by   uuid        NOT NULL REFERENCES users(id),
  requested_role text        NOT NULL CHECK (requested_role ~ '^[A-Z_]{1,32}$'),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  status         text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'EXECUTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED')),
  decided_by     uuid        REFERENCES users(id),
  decided_role   text        CHECK (decided_role IS NULL OR decided_role ~ '^[A-Z_]{1,32}$'),
  decided_at     timestamptz,
  decision_note  text        CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  -- What execution produced (transaction id, balance) or why it failed.
  result         jsonb,
  CHECK (expires_at > requested_at),
  -- Four eyes: nobody approves or rejects their own request (cancelling it is
  -- the requester's own, separate action).
  CHECK (decided_by IS NULL OR decided_by <> requested_by OR status IN ('CANCELLED', 'EXPIRED')),
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CHECK (status NOT IN ('EXECUTED', 'REJECTED', 'FAILED') OR decided_by IS NOT NULL)
);
CREATE INDEX admin_approval_requests_status_idx ON admin_approval_requests (status, requested_at DESC);
CREATE INDEX admin_approval_requests_target_idx ON admin_approval_requests (target_type, target_id, requested_at DESC);

CREATE FUNCTION admin_approval_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval requests cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'a decided approval request is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id <> OLD.id OR NEW.action <> OLD.action OR NEW.target_type <> OLD.target_type OR NEW.target_id <> OLD.target_id
     OR NEW.params <> OLD.params OR NEW.reason <> OLD.reason OR NEW.requested_by <> OLD.requested_by
     OR NEW.requested_role <> OLD.requested_role OR NEW.requested_at <> OLD.requested_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'the content of an approval request cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_approval_requests_guard BEFORE UPDATE OR DELETE ON admin_approval_requests
  FOR EACH ROW EXECUTE FUNCTION admin_approval_requests_guard();

-- 3 -------------------------------------------------------------------------
CREATE TABLE phone_verification_challenges (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id),
  -- The number the code was sent to; verification applies only if the account still has it.
  phone_e164    text        NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  code_mac      text        NOT NULL CHECK (code_mac ~ '^[0-9a-f]{64}$'),
  attempts      integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts  integer     NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  provider      text        NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 40),
  delivery      text        NOT NULL DEFAULT 'PENDING' CHECK (delivery IN ('PENDING', 'SENT', 'FAILED', 'REJECTED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  superseded_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (attempts <= max_attempts)
);
CREATE UNIQUE INDEX phone_verification_one_live_idx ON phone_verification_challenges (user_id)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;
CREATE INDEX phone_verification_user_created_idx ON phone_verification_challenges (user_id, created_at DESC);

-- 4 -------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN age_verified_at timestamptz;
ALTER TABLE users ADD COLUMN age_verification_provider text;
ALTER TABLE users ADD COLUMN age_verification_ref text;
ALTER TABLE users ADD CONSTRAINT users_age_verification_consistent
  CHECK ((age_verified_at IS NULL) = (age_verification_provider IS NULL));
ALTER TABLE users ADD CONSTRAINT users_age_verification_ref_check
  CHECK (age_verification_ref IS NULL OR char_length(age_verification_ref) <= 200);

SELECT casino_apply_app_grants();
