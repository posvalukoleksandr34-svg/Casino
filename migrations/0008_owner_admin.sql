-- Owner administration: audit fields, last-owner protection, staff MFA,
-- prediction windows and indexes for the back office. Additive only: no
-- table is dropped and no existing row loses data.
--
-- 1. audit_logs.actor_role / audit_logs.outcome: the role the actor held when
--    acting, and whether the attempt succeeded, was denied or failed. Existing
--    rows get outcome SUCCESS (every row written so far records a completed
--    change) and actor_role NULL (not recorded at the time). audit_logs stays
--    append-only (its triggers are unchanged; adding a column updates no rows).
-- 2. users_keep_an_owner: once an owner exists, the last ACTIVE owner can be
--    neither demoted, suspended nor deleted. The application also locks every
--    owner row before such a change, so two concurrent demotions cannot both
--    pass. Recovery when every owner is lost: docs/admin.md.
-- 3. Staff MFA (TOTP, RFC 6238): user_mfa holds the encrypted secret, the last
--    accepted time step (replay protection) and hashed one-time recovery codes.
--    sessions.mfa_verified_at marks sessions that passed the second factor.
--    platform_settings.staff_mfa_required lets an owner require it for staff.
-- 4. sports_markets.opens_at / closes_at: optional prediction window set by an
--    operator. NULL means "open now" / "closes at kick-off"; the effective
--    close is never later than kick-off (enforced by the application).
-- 5. Indexes for back-office filters and period queries.

-- 1 -------------------------------------------------------------------------
ALTER TABLE audit_logs ADD COLUMN actor_role text;
ALTER TABLE audit_logs ADD COLUMN outcome text NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_outcome_check CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED'));
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_role_check CHECK (actor_role IS NULL OR actor_role ~ '^[A-Z_]{1,32}$');
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_outcome_idx ON audit_logs (outcome, created_at DESC) WHERE outcome <> 'SUCCESS';

-- 2 -------------------------------------------------------------------------
CREATE FUNCTION users_keep_an_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role::text = 'OWNER' AND OLD.status = 'ACTIVE'
     AND NOT (NEW.role::text = 'OWNER' AND NEW.status = 'ACTIVE')
     AND NOT EXISTS (
       SELECT 1 FROM users u WHERE u.id <> OLD.id AND u.role::text = 'OWNER' AND u.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'the last active owner cannot be demoted, suspended or deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_keep_an_owner BEFORE UPDATE OF role, status ON users
  FOR EACH ROW EXECUTE FUNCTION users_keep_an_owner();

-- 3 -------------------------------------------------------------------------
CREATE TABLE user_mfa (
  user_id         uuid        PRIMARY KEY REFERENCES users(id),
  -- AES-256-GCM with the seed key ring (same format as seed_pairs.server_seed_enc).
  secret_enc      text        NOT NULL,
  -- NULL while enrolment is pending (secret issued, first code not yet confirmed).
  enabled_at      timestamptz,
  -- Highest TOTP time step accepted so far: a code is never accepted twice.
  last_step       bigint      NOT NULL DEFAULT 0 CHECK (last_step >= 0),
  -- SHA-256 of unused recovery codes; a code is removed when used.
  recovery_hashes text[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE platform_settings ADD COLUMN staff_mfa_required boolean NOT NULL DEFAULT false;

-- 4 -------------------------------------------------------------------------
ALTER TABLE sports_markets ADD COLUMN opens_at timestamptz;
ALTER TABLE sports_markets ADD COLUMN closes_at timestamptz;
ALTER TABLE sports_markets ADD CONSTRAINT sports_markets_window CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at);

-- 5 -------------------------------------------------------------------------
CREATE INDEX users_created_idx ON users (created_at DESC);
CREATE INDEX users_status_created_idx ON users (status, created_at DESC);
CREATE INDEX game_rounds_started_idx ON game_rounds (started_at);
CREATE INDEX sessions_last_seen_idx ON sessions (last_seen_at) WHERE revoked_at IS NULL;
CREATE INDEX sports_tickets_placed_idx ON sports_tickets (placed_at);
CREATE INDEX ledger_transactions_type_created_idx ON ledger_transactions (type, created_at);

SELECT casino_apply_app_grants();
