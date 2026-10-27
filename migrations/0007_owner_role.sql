-- Owner role and owner-granted virtual test chips: enum values only.
--
-- PostgreSQL cannot use an enum value in the transaction that added it, so the
-- tables, triggers and functions that refer to these values are in 0008.
--
-- * user_role 'OWNER': full administrative authority. Public registration
--   always creates PLAYER accounts; the first owner is provisioned from the
--   command line (npm run admin:provision-owner), later owners by an owner.
-- * ledger_tx_type 'CHIP_GRANT': virtual test chips granted to a player by an
--   owner (player wallet +amount, promotions account -amount), always with a
--   reason and an audited admin action. Chips have no monetary value.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'OWNER';
ALTER TYPE ledger_tx_type ADD VALUE IF NOT EXISTS 'CHIP_GRANT';
