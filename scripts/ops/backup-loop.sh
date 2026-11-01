#!/usr/bin/env bash
# Runs scripts/ops/backup.sh every BACKUP_INTERVAL_HOURS (default 24) inside
# the Compose "backup" service. A failed run is reported (exit code in the log,
# BACKUP_FAILURE_URL ping) and retried at the next interval; the loop itself
# keeps running so one failure does not silently stop all future backups.
set -uo pipefail
interval="${BACKUP_INTERVAL_HOURS:-24}"
[[ "$interval" =~ ^[0-9]+$ && "$interval" -ge 1 ]] || { echo "BACKUP_INTERVAL_HOURS must be a whole number ≥ 1" >&2; exit 1; }
while true; do
  if bash "$(dirname "$0")/backup.sh"; then echo '{"msg":"backup run ok"}'; else echo "{\"msg\":\"backup run failed\",\"exit\":$?}" >&2; fi
  sleep "$(( interval * 3600 ))"
done
