#!/bin/sh
# First-start initialisation of the Compose PostgreSQL volume (runs once, as the
# bootstrap superuser, from /docker-entrypoint-initdb.d).
#
#   casino_migrator  owns the database and schema; runs migrations only
#   casino_app       runtime role of the web app: no ownership, no DDL, no TEMP;
#                    table privileges are granted by migration 0004
#                    (casino_apply_app_grants) after every migration run
#
# The superuser password is used only here and for break-glass maintenance.
set -eu
: "${CASINO_MIGRATOR_PASSWORD:?CASINO_MIGRATOR_PASSWORD is required}"
: "${CASINO_APP_PASSWORD:?CASINO_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v dbname="$POSTGRES_DB" -v migrator_pw="$CASINO_MIGRATOR_PASSWORD" -v app_pw="$CASINO_APP_PASSWORD" <<'SQL'
CREATE ROLE casino_migrator LOGIN PASSWORD :'migrator_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE casino_app      LOGIN PASSWORD :'app_pw'      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

ALTER DATABASE :"dbname" OWNER TO casino_migrator;
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO casino_app;   -- deliberately no TEMPORARY

ALTER SCHEMA public OWNER TO casino_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO casino_app;           -- no CREATE
SQL
