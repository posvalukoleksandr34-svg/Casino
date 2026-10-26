-- =============================================================================
-- 0002_risk_snapshot: lock the house bankroll and read the open-exposure
-- snapshot in one round trip. Inside a VOLATILE plpgsql function each
-- statement takes a fresh snapshot (READ COMMITTED), so the exposure sums are
-- read *after* the row lock is granted and include every wager committed by
-- transactions that held the lock before us.
-- =============================================================================
CREATE FUNCTION risk_snapshot(p_game_id text, p_exclude_round uuid)
RETURNS TABLE (house_balance bigint, exposure_game bigint, exposure_total bigint)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_balance bigint;
BEGIN
  SELECT a.balance INTO v_balance FROM ledger_accounts a WHERE a.code = 'SYSTEM:HOUSE_BANKROLL' FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'house bankroll account missing';
  END IF;
  RETURN QUERY
    SELECT v_balance,
           coalesce(sum(greatest(r.max_payout - r.stake_total, 0)) FILTER (WHERE r.game_id = p_game_id), 0)::bigint,
           coalesce(sum(greatest(r.max_payout - r.stake_total, 0)), 0)::bigint
    FROM game_rounds r
    WHERE r.status = 'OPEN' AND (p_exclude_round IS NULL OR r.id <> p_exclude_round);
END;
$$;
