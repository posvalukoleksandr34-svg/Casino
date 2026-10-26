# Sourced by the ops scripts: use PostgreSQL client tools of the SAME major
# version as the server. A newer pg_dump writes settings an older server
# rejects on restore (e.g. pg_dump 17+ emits `SET transaction_timeout`), so a
# mismatched client would produce backups that cannot be restored with
# --exit-on-error.
use_matching_pg_tools() {
  local url="$1" major client
  major="$(psql -X -At -v ON_ERROR_STOP=1 --dbname="$url" -c 'SHOW server_version_num')"
  major=$(( major / 10000 ))
  # Debian/Ubuntu keep every installed major under /usr/lib/postgresql/<major>/bin.
  if [[ -x "/usr/lib/postgresql/$major/bin/pg_dump" ]]; then
    export PATH="/usr/lib/postgresql/$major/bin:$PATH"
  fi
  client="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
  if [[ "$client" != "$major" ]]; then
    echo "pg_dump $client does not match server $major: install postgresql-client-$major (or put its bin directory first on PATH)" >&2
    return 1
  fi
}
