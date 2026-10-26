-- Least-privilege runtime role and a tamper-proof balance guard.
--
-- 1. Balance guard. ledger_accounts_guard allowed balance changes whenever the
--    session flag casino.ledger_posting was 'on' — but any session can SET that
--    flag and then UPDATE a balance directly. A balance change is now accepted
--    only when ALL hold:
--      * the flag is on (set by the posting trigger),
--      * it happens inside a nested trigger (pg_trigger_depth() > 1: the
--        posting trigger's own UPDATE, not a statement issued by a client),
--      * it runs with the privileges of the table owner — the posting trigger
--        is SECURITY DEFINER, so an application role that does not own the
--        table cannot satisfy this even through temporary objects.
--    Account identity columns, including created_at, are immutable.
--
-- 2. casino_apply_app_grants(): grants the runtime role "casino_app" (if it
--    exists) exactly what the application needs:
--      * append-only tables (those guarded by forbid_mutation): SELECT, INSERT
--      * tables the application prunes: SELECT, INSERT, UPDATE, DELETE
--      * schema_migrations: SELECT
--      * every other table: SELECT, INSERT, UPDATE (UPDATE on ledger_accounts
--        is needed for SELECT … FOR UPDATE row locks; the guard above blocks
--        any balance or identity change)
--      * sequences: USAGE, SELECT
--    The role owns nothing and gets no TRUNCATE, REFERENCES or TRIGGER, so it
--    cannot alter tables or disable triggers. The migration runner calls this
--    function after every run, so tables added by later migrations are covered.
--    Creating the LOGIN role (with its password) is a deployment step — see
--    deploy/postgres/init/01-roles.sh and docs/operations.md.

CREATE OR REPLACE FUNCTION ledger_accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_name name;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger accounts cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.balance IS DISTINCT FROM OLD.balance OR NEW.entry_count IS DISTINCT FROM OLD.entry_count THEN
    SELECT pg_get_userbyid(c.relowner) INTO owner_name FROM pg_class c WHERE c.oid = TG_RELID;
    IF coalesce(current_setting('casino.ledger_posting', true), '') <> 'on'
       OR pg_trigger_depth() < 2
       OR current_user <> owner_name THEN
      RAISE EXCEPTION 'account balances can only change through ledger entries' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.id <> OLD.id OR NEW.code <> OLD.code OR NEW.type <> OLD.type
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.currency <> OLD.currency
     OR NEW.allow_negative <> OLD.allow_negative OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ledger account identity is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- The posting trigger runs with the table owner's privileges (fixed search_path).
ALTER FUNCTION ledger_entries_apply() SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION casino_apply_app_grants() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t record;
  prunable text[] := ARRAY['idempotency_keys', 'rate_limit_buckets', 'sessions'];
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
