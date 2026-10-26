#!/usr/bin/env bash
# Backup → restore → verify drill in a DISPOSABLE database (docs/operations.md §6;
# CI runs it after the integration suite).
#
#   DATABASE_URL=<source>  RESTORE_ADMIN_URL=<role that may CREATE DATABASE, on a
#   maintenance database such as /postgres>  npm run ops:restore-check
#
# 1. pg_dump the source (custom format) and record its checksum;
# 2. create a NEW database casino_restore_check_<time>_<random> — the only
#    database this script ever writes to, and the only one it drops;
# 3. pg_restore into it (--exit-on-error), then `npm run db:migrate` (verifies
#    migration checksums, re-applies grants and reference data);
# 4. verify: append-only row counts lie between the source's counts before and
#    after the dump (exactly equal on a quiet source), the same append-only
#    triggers exist, and `npm run job:reconcile` reports OK on the copy;
# 5. drop the disposable database (also on failure). KEEP_RESTORE_DB=1 keeps it.
# Never restores over an existing database. Never prints connection URLs.
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL (source database) is required}"
: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL (a role allowed to CREATE DATABASE) is required}"
SOURCE_URL="$DATABASE_URL"
DB="casino_restore_check_$(date -u +%Y%m%d%H%M%S)_$RANDOM"
[[ "$DB" =~ ^casino_restore_check_[0-9]+_[0-9]+$ ]] || { echo "unexpected database name" >&2; exit 1; }
TARGET_URL="$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$RESTORE_ADMIN_URL" "$DB")"
WORK="$(mktemp -d)"
DUMP="$WORK/source.dump"
created=0

cleanup() {
  rm -rf "$WORK"
  if [[ "$created" == 1 && "${KEEP_RESTORE_DB:-}" != 1 ]]; then
    psql -X -q -v ON_ERROR_STOP=1 --dbname="$RESTORE_ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null || echo "warning: could not drop $DB" >&2
  fi
}
trap cleanup EXIT

APPEND_ONLY="ledger_transactions ledger_entries bets payouts audit_logs"
counts() { # url → "table=n …" for the append-only tables (and rounds, which only grow)
  local sql="" t
  for t in $APPEND_ONLY game_rounds; do sql+="SELECT '$t', count(*) FROM $t UNION ALL "; done
  psql -X -At -F= -v ON_ERROR_STOP=1 --dbname="$1" -c "${sql% UNION ALL }"
}
triggers() {
  psql -X -At -v ON_ERROR_STOP=1 --dbname="$1" -c \
    "SELECT tgrelid::regclass || ':' || tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1"
}

echo "== 1. dump source"
before="$(counts "$SOURCE_URL")"
pg_dump --format=custom --no-owner --no-privileges --file="$DUMP" --dbname="$SOURCE_URL"
after="$(counts "$SOURCE_URL")"
echo "dump: $(stat -c %s "$DUMP") bytes, sha256 $(sha256sum "$DUMP" | cut -c1-16)…"

echo "== 2. create disposable database $DB"
exists="$(psql -X -At -v ON_ERROR_STOP=1 --dbname="$RESTORE_ADMIN_URL" -c "SELECT count(*) FROM pg_database WHERE datname = '$DB'")"
[[ "$exists" == 0 ]] || { echo "refusing: $DB already exists" >&2; exit 1; }
psql -X -q -v ON_ERROR_STOP=1 --dbname="$RESTORE_ADMIN_URL" -c "CREATE DATABASE \"$DB\""
created=1

echo "== 3. restore and migrate"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_URL" "$DUMP"
DATABASE_URL="$TARGET_URL" npx tsx scripts/migrate.ts

echo "== 4. verify"
restored="$(counts "$TARGET_URL")"
fail=0
for t in $APPEND_ONLY game_rounds; do
  b="$(grep "^$t=" <<<"$before" | cut -d= -f2)"; a="$(grep "^$t=" <<<"$after" | cut -d= -f2)"; r="$(grep "^$t=" <<<"$restored" | cut -d= -f2)"
  if (( r < b || r > a )); then echo "MISMATCH $t: restored $r, source $b..$a"; fail=1; else echo "ok $t: $r rows"; fi
done
if [[ "$(triggers "$SOURCE_URL")" != "$(triggers "$TARGET_URL")" ]]; then echo "MISMATCH: trigger sets differ"; fail=1; else echo "ok triggers: $(triggers "$TARGET_URL" | wc -l) user triggers identical"; fi
if ! DATABASE_URL="$TARGET_URL" npx tsx scripts/reconcile.ts > "$WORK/reconcile.json"; then
  echo "MISMATCH: reconciliation of the restored copy failed"; cat "$WORK/reconcile.json"; fail=1
else
  echo "ok reconciliation: $(node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(`${r.status}, ${r.checks.length} checks, ${r.mismatches} mismatches`)' "$WORK/reconcile.json")"
fi
(( fail == 0 )) || { echo "RESTORE CHECK FAILED"; exit 1; }
echo "RESTORE CHECK PASSED ($DB$([[ "${KEEP_RESTORE_DB:-}" == 1 ]] && echo ', kept' || echo ', dropped'))"
