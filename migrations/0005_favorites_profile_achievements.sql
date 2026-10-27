-- Lobby favourites, profile display fields and cosmetic achievements.
--
-- 1. user_favorites: a player's favourite games. Unfavouriting deletes the row,
--    so the runtime role gets DELETE on this table (casino_apply_app_grants is
--    redefined below with user_favorites in its prunable list; nothing else
--    changes).
-- 2. users.display_name / users.avatar: optional profile fields. The avatar is
--    the id of a built-in preset (no uploads); the application validates the
--    preset list, the database enforces the shape.
-- 3. user_achievements: cosmetic badges, derived on the server from recorded
--    facts. Append-only (forbid_mutation) and one row per user and badge, so an
--    award is idempotent and can never be edited or withdrawn by the app.
--    Achievements carry no balance, value or reward of any kind.

CREATE TABLE user_favorites (
  user_id    uuid        NOT NULL REFERENCES users(id),
  game_id    text        NOT NULL REFERENCES games(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

ALTER TABLE users ADD COLUMN display_name text;
ALTER TABLE users ADD COLUMN avatar text;
ALTER TABLE users ADD CONSTRAINT users_display_name_shape CHECK (
  display_name IS NULL
  OR (char_length(display_name) BETWEEN 2 AND 32 AND display_name = btrim(display_name) AND display_name !~ '[[:cntrl:]]')
);
ALTER TABLE users ADD CONSTRAINT users_avatar_shape CHECK (avatar IS NULL OR avatar ~ '^[a-z0-9-]{1,32}$');

CREATE TABLE user_achievements (
  user_id        uuid        NOT NULL REFERENCES users(id),
  achievement_id text        NOT NULL CHECK (achievement_id ~ '^[a-z0-9-]{1,48}$'),
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  -- Which recorded fact earned it (e.g. the round that was verified).
  evidence       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, achievement_id)
);
CREATE TRIGGER user_achievements_append_only BEFORE UPDATE OR DELETE ON user_achievements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER user_achievements_no_truncate BEFORE TRUNCATE ON user_achievements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION casino_apply_app_grants() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t record;
  prunable text[] := ARRAY['idempotency_keys', 'rate_limit_buckets', 'sessions', 'user_favorites'];
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
