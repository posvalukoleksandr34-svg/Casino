-- 0014: identity verification (KYC) with private documents and risk flags,
-- support tickets with attachments, and VIP tiers.
--
-- Uploaded files are never stored in the database or under public/: the
-- rows hold metadata and a random storage key; the bytes live in private
-- storage (server/storage) and are served only through authenticated routes.
--
-- Additive only.

-- Identity verification -------------------------------------------------------
CREATE TABLE kyc_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id),
  kind          text NOT NULL CHECK (kind IN ('ID_FRONT', 'ID_BACK', 'PROOF_OF_ADDRESS', 'SELFIE', 'OTHER')),
  file_name     text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 120),
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key   text NOT NULL UNIQUE CHECK (storage_key ~ '^[a-z]+/[0-9a-f-]{36}$'),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  review_note   text,
  reviewed_by   uuid REFERENCES users (id),
  reviewed_at   timestamptz,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewed_by IS NULL OR reviewed_by <> user_id),
  CHECK ((status = 'PENDING') = (reviewed_at IS NULL))
);
CREATE INDEX kyc_documents_user_idx ON kyc_documents (user_id, uploaded_at DESC);

-- Every verification decision (append-only): who decided what, when, and why.
CREATE TABLE kyc_reviews (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id),
  decision     text NOT NULL CHECK (decision IN ('SUBMITTED', 'VERIFIED', 'REJECTED')),
  note         text CHECK (note IS NULL OR length(note) <= 500),
  actor_id     uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (decision = 'SUBMITTED' OR actor_id <> user_id)
);
CREATE INDEX kyc_reviews_user_idx ON kyc_reviews (user_id, id DESC);
CREATE TRIGGER kyc_reviews_append_only BEFORE UPDATE OR DELETE ON kyc_reviews FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER kyc_reviews_no_truncate BEFORE TRUNCATE ON kyc_reviews FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Compliance risk flags on an account. An open flag sends every withdrawal of
-- the account to manual review.
CREATE TABLE risk_flags (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id),
  kind          text NOT NULL CHECK (kind IN ('DOCUMENT_MISMATCH', 'MULTIPLE_ACCOUNTS', 'PAYMENT_CHARGEBACK', 'BONUS_ABUSE', 'SOURCE_OF_FUNDS', 'OTHER')),
  severity      text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  note          text NOT NULL CHECK (length(note) BETWEEN 5 AND 500),
  created_by    uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_by   uuid REFERENCES users (id),
  resolved_at   timestamptz,
  resolution    text CHECK (resolution IS NULL OR length(resolution) BETWEEN 5 AND 500),
  CHECK (created_by <> user_id),
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL) AND (resolved_at IS NULL) = (resolution IS NULL))
);
CREATE INDEX risk_flags_open_idx ON risk_flags (user_id) WHERE resolved_at IS NULL;

-- Support ---------------------------------------------------------------------
CREATE TABLE support_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id),
  category      text NOT NULL CHECK (category IN ('ACCOUNT', 'PAYMENTS', 'VERIFICATION', 'BONUSES', 'GAMES', 'RESPONSIBLE_PLAY', 'OTHER')),
  subject       text NOT NULL CHECK (length(subject) BETWEEN 3 AND 120),
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'AWAITING_PLAYER', 'RESOLVED', 'CLOSED')),
  priority      text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH')),
  assigned_to   uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, updated_at DESC);
CREATE INDEX support_tickets_queue_idx ON support_tickets (priority DESC, updated_at) WHERE status IN ('OPEN', 'AWAITING_PLAYER');

-- Messages are append-only; internal notes are visible to staff only.
CREATE TABLE support_messages (
  id            bigserial PRIMARY KEY,
  ticket_id     uuid NOT NULL REFERENCES support_tickets (id),
  author_id     uuid NOT NULL REFERENCES users (id),
  from_staff    boolean NOT NULL,
  internal      boolean NOT NULL DEFAULT false,
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT internal OR from_staff)
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, id);
CREATE TRIGGER support_messages_append_only BEFORE UPDATE OR DELETE ON support_messages FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER support_messages_no_truncate BEFORE TRUNCATE ON support_messages FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TABLE support_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES support_tickets (id),
  message_id    bigint NOT NULL REFERENCES support_messages (id),
  file_name     text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 120),
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key   text NOT NULL UNIQUE CHECK (storage_key ~ '^[a-z]+/[0-9a-f-]{36}$'),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_attachments_ticket_idx ON support_attachments (ticket_id);
CREATE TRIGGER support_attachments_append_only BEFORE UPDATE OR DELETE ON support_attachments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER support_attachments_no_truncate BEFORE TRUNCATE ON support_attachments FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- VIP tiers -------------------------------------------------------------------
-- A tier is reached by lifetime casino wagering (users.vip_wagered, counted at
-- settlement). Perks are real and enforced in code: a larger daily free
-- top-up, and priority in the support queue.
CREATE TABLE vip_tiers (
  level               integer PRIMARY KEY CHECK (level BETWEEN 1 AND 10),
  name                text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 30),
  min_wagered         bigint NOT NULL UNIQUE CHECK (min_wagered >= 0),
  -- Extra daily free top-up, in percent of the standard amount.
  top_up_bonus_pct    integer NOT NULL DEFAULT 0 CHECK (top_up_bonus_pct BETWEEN 0 AND 500),
  priority_support    boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((level = 1) = (min_wagered = 0))
);
ALTER TABLE users ADD COLUMN vip_wagered bigint NOT NULL DEFAULT 0 CHECK (vip_wagered >= 0);
ALTER TABLE users ADD COLUMN vip_level integer NOT NULL DEFAULT 1 CHECK (vip_level BETWEEN 1 AND 10);

SELECT casino_apply_app_grants();
