-- The automatic roulette table: spectator ("table") spins that run on a
-- shared schedule whether or not anyone bets. Additive only.
--
-- A table spin is NOT a wager: these tables have no link to users, wallets,
-- rounds or the ledger, and nothing here can move chips. Player wagers stay
-- ordinary game_rounds with the player's own provably fair seeds.
--
-- 1. roulette_table_days: one server seed per UTC day. Its SHA-256
--    commitment is published (GET /api/roulette/table) before the day's
--    spins close; the seed itself (encrypted at rest, like player seeds) is
--    revealed only after the day has ended. Append-only: a commitment can
--    never be replaced.
-- 2. roulette_table_spins: the public history of table spins, recorded when a
--    spin is first revealed after its betting window closed. The result is
--    derived from the day seed (see src/engine/games/roulette/table.ts), so
--    anyone can recompute it once the seed is revealed. Append-only.

CREATE TABLE roulette_table_days (
  day              date        PRIMARY KEY,
  server_seed_enc  text        NOT NULL,
  server_seed_hash text        NOT NULL CHECK (server_seed_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roulette_table_spins (
  slot        bigint      PRIMARY KEY CHECK (slot >= 0),
  day         date        NOT NULL REFERENCES roulette_table_days(day),
  result      smallint    NOT NULL CHECK (result BETWEEN 0 AND 36),
  closed_at   timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recorded_at >= closed_at - interval '5 seconds')
);
CREATE INDEX roulette_table_spins_recent ON roulette_table_spins (slot DESC);

CREATE TRIGGER roulette_table_days_append_only BEFORE UPDATE OR DELETE ON roulette_table_days
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER roulette_table_days_no_truncate BEFORE TRUNCATE ON roulette_table_days
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER roulette_table_spins_append_only BEFORE UPDATE OR DELETE ON roulette_table_spins
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER roulette_table_spins_no_truncate BEFORE TRUNCATE ON roulette_table_spins
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

SELECT casino_apply_app_grants();
