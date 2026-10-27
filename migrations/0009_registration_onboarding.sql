-- Registration with e-mail verification and mandatory player onboarding.
-- Additive only: no table is dropped and no existing row loses data.
--
-- 1. users.email_verified_at / email_verification_method: when and how the
--    account's current e-mail address was confirmed. CODE = a six-digit code
--    sent to the address was entered; OPERATOR = created by an operator script
--    (seed, load test); LEGACY_MIGRATION = the account existed before this
--    migration. LEGACY_MIGRATION is a compatibility decision so that existing
--    accounts keep signing in: it is NOT evidence that the address was ever
--    verified (docs/onboarding.md).
-- 2. Player profile collected after verification: legal first and last name,
--    date of birth, country of residence (ISO 3166-1 alpha-2) and a phone
--    number in E.164 form. phone_verified_at stays NULL until a real phone
--    challenge succeeds (none exists yet), so a stored number is never
--    presented as verified. Existing accounts get NULLs: nothing is invented.
-- 3. Onboarding state. onboarding_required is TRUE for accounts registered from
--    now on and FALSE for every existing account (grandfathered: they keep
--    their access and may add details in settings). A required onboarding is
--    pending while onboarding_completed_at is NULL; the application refuses
--    every player page and API except the onboarding flow in that state.
-- 4. Accepted terms and privacy-notice versions, recorded at registration.
-- 5. email_verification_challenges: one row per code sent. Only an HMAC of the
--    code (keyed with a server secret, bound to the challenge id) is stored,
--    so a database leak alone does not allow the 10^6 codes to be tested
--    offline. At most one live challenge per account (partial unique index):
--    issuing a new code supersedes the previous one. Attempts are counted per
--    challenge; a challenge is consumed exactly once.

-- 1 -------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN email_verification_method text;
UPDATE users SET email_verified_at = created_at, email_verification_method = 'LEGACY_MIGRATION';
ALTER TABLE users ADD CONSTRAINT users_email_verification_method_check
  CHECK (email_verification_method IN ('CODE', 'OPERATOR', 'LEGACY_MIGRATION'));
ALTER TABLE users ADD CONSTRAINT users_email_verified_consistent
  CHECK ((email_verified_at IS NULL) = (email_verification_method IS NULL));
CREATE INDEX users_unverified_created_idx ON users (created_at) WHERE email_verified_at IS NULL;

-- 2 -------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN first_name text;
ALTER TABLE users ADD COLUMN last_name text;
ALTER TABLE users ADD COLUMN date_of_birth date;
ALTER TABLE users ADD COLUMN country_code text;
ALTER TABLE users ADD COLUMN phone_e164 text;
ALTER TABLE users ADD COLUMN phone_verified_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_first_name_check CHECK (first_name IS NULL OR char_length(first_name) BETWEEN 1 AND 64);
ALTER TABLE users ADD CONSTRAINT users_last_name_check CHECK (last_name IS NULL OR char_length(last_name) BETWEEN 1 AND 64);
ALTER TABLE users ADD CONSTRAINT users_country_code_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
ALTER TABLE users ADD CONSTRAINT users_phone_e164_check CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE users ADD CONSTRAINT users_phone_verified_check CHECK (phone_verified_at IS NULL OR phone_e164 IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT users_date_of_birth_check CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01');

-- 3 -------------------------------------------------------------------------
-- Existing rows get FALSE; the default for new rows is then switched to TRUE.
ALTER TABLE users ADD COLUMN onboarding_required boolean NOT NULL DEFAULT false;
ALTER TABLE users ALTER COLUMN onboarding_required SET DEFAULT true;
ALTER TABLE users ADD COLUMN onboarding_completed_at timestamptz;
-- A completed onboarding means the whole profile was stored (deletion erases it).
ALTER TABLE users ADD CONSTRAINT users_onboarding_profile_check CHECK (
  onboarding_completed_at IS NULL OR status = 'DELETED' OR (
    first_name IS NOT NULL AND last_name IS NOT NULL AND date_of_birth IS NOT NULL
    AND country_code IS NOT NULL AND phone_e164 IS NOT NULL
  )
);

-- 4 -------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN terms_version text;
ALTER TABLE users ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN privacy_version text;
ALTER TABLE users ADD COLUMN privacy_accepted_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_terms_consistent CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));
ALTER TABLE users ADD CONSTRAINT users_privacy_consistent CHECK ((privacy_version IS NULL) = (privacy_accepted_at IS NULL));

-- 5 -------------------------------------------------------------------------
CREATE TABLE email_verification_challenges (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id),
  -- SIGNUP confirms the registration address; EMAIL_CHANGE confirms a new one.
  purpose       text        NOT NULL CHECK (purpose IN ('SIGNUP', 'EMAIL_CHANGE')),
  -- The address the code was sent to (the new address for EMAIL_CHANGE).
  email         text        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  -- HMAC-SHA256(server key, "<id>:<code>"), hex. Never the code itself.
  code_mac      text        NOT NULL CHECK (code_mac ~ '^[0-9a-f]{64}$'),
  attempts      integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts  integer     NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  delivery      text        NOT NULL DEFAULT 'PENDING' CHECK (delivery IN ('PENDING', 'SENT', 'FAILED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  superseded_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (attempts <= max_attempts)
);
CREATE UNIQUE INDEX email_verification_one_live_idx ON email_verification_challenges (user_id)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;
CREATE INDEX email_verification_user_created_idx ON email_verification_challenges (user_id, created_at DESC);

SELECT casino_apply_app_grants();
