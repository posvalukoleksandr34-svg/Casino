-- Explicit expiry schedule for rounds that settle by elapsed time (Crash).
--
-- Before: the expiry job scanned the oldest OPEN rounds of every game, so a
-- backlog of rounds that can never expire by time (e.g. Mines boards left
-- open) could fill every batch and starve due Crash rounds.
--
-- After: the game engine states when an open round becomes decidable by time
-- (GameModule.expiresAfterMs) and the server stores it in expires_at. The
-- expiry job selects only OPEN rounds with expires_at <= now, oldest due first,
-- through a partial index that contains nothing else.

ALTER TABLE game_rounds
  ADD COLUMN expires_at      timestamptz,
  ADD COLUMN expiry_attempts integer NOT NULL DEFAULT 0 CHECK (expiry_attempts >= 0);

-- A finished round is never scheduled.
ALTER TABLE game_rounds
  ADD CONSTRAINT game_rounds_expiry_only_open CHECK (status = 'OPEN' OR expires_at IS NULL);

-- Rounds that were open when this migration ran: schedule them for an
-- immediate check. The job asks the engine, which either settles the round or
-- writes the exact due time (or NULL for games that never expire), so this
-- backfill is self-correcting and touches no money.
UPDATE game_rounds SET expires_at = started_at WHERE status = 'OPEN';

CREATE INDEX game_rounds_expiry_due_idx ON game_rounds (expires_at, id)
  WHERE status = 'OPEN' AND expires_at IS NOT NULL;
