#!/usr/bin/env bash
# Encrypted logical backup of the casino database (provider-neutral;
# docs/backup-recovery.md).
#
#   DATABASE_URL=postgresql://casino_migrator:…@host/casino \
#   BACKUP_DIR=/var/backups/casino \
#   BACKUP_GPG_RECIPIENT=backups@your.domain BACKUP_GPG_PUBLIC_KEY_FILE=/run/secrets/backup.pub.asc \
#   BACKUP_RETENTION_DAYS=35 \
#   BACKUP_UPLOAD_COMMAND='rclone copyto "$1" offsite:aurovane/$(basename "$1")' \
#   BACKUP_HEARTBEAT_URL=https://monitor.example/ping/<id> \
#   npm run ops:backup
#
# 1. Custom-format pg_dump (no owners or privileges: grants are re-applied by
#    `npm run db:migrate` after a restore), umask 077, read-only on the source.
# 2. The archive is checked (pg_restore --list), then ENCRYPTED to the backup
#    public key and the plaintext deleted. Encryption is required: without a
#    recipient the script refuses, unless BACKUP_ALLOW_PLAINTEXT=true is set
#    explicitly (only for storage that encrypts at rest under separate keys).
#    Only the PUBLIC key is ever on the backup host; the private key that can
#    decrypt lives offline with the operator (restore procedure).
# 3. Integrity: the encrypted file is parsed (gpg --list-packets) and a
#    .sha256 is written next to it.
# 4. Optional off-site copy: BACKUP_UPLOAD_COMMAND runs with the file as $1
#    (and again for the .sha256); any provider (rclone, aws, gsutil, rsync).
# 5. Retention: BACKUP_RETENTION_DAYS prunes local copies older than that
#    (off-site retention belongs to the storage provider's lifecycle policy).
# 6. Monitoring: BACKUP_STATUS_FILE gets a JSON record of the last success;
#    BACKUP_HEARTBEAT_URL is requested on success and BACKUP_FAILURE_URL (default
#    "<heartbeat>/fail") on failure — wire them to a dead-man's-switch monitor
#    that alerts when no success arrives in time. Exit code non-zero on failure.
# Never prints the database URL, passwords or key material.
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL (source database) is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-}"
RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
KEY_FILE="${BACKUP_GPG_PUBLIC_KEY_FILE:-}"
HEARTBEAT="${BACKUP_HEARTBEAT_URL:-}"
FAILURE_URL="${BACKUP_FAILURE_URL:-${HEARTBEAT:+$HEARTBEAT/fail}}"

ping() { # url — best effort, never leaks anything but the fact of success/failure
  [[ -n "$1" ]] || return 0
  if command -v curl > /dev/null; then curl -fsS -m 10 --retry 2 -o /dev/null "$1" || echo "warning: monitoring ping failed" >&2
  elif command -v wget > /dev/null; then wget -q -T 10 -O /dev/null "$1" || echo "warning: monitoring ping failed" >&2
  else echo "warning: no curl or wget: monitoring ping skipped" >&2
  fi
}
plain=""   # unencrypted dump while it exists; never left behind on failure
keyring=""
partial="" # outputs of an unfinished run, removed on failure
cleanup() {
  if [[ -n "$plain" && -n "$RECIPIENT" ]]; then rm -f "$plain"; fi
  if [[ -n "$keyring" ]]; then rm -rf "$keyring"; fi
}
on_error() {
  local line="$1"
  if [[ -n "$partial" ]]; then rm -f "$partial" "$partial.gpg" "$partial.gpg.sha256" "$partial.sha256"; fi
  echo "{\"msg\":\"backup failed\",\"line\":$line}" >&2
  ping "$FAILURE_URL"
}
trap 'on_error $LINENO' ERR
trap cleanup EXIT

if [[ -z "$RECIPIENT" && "${BACKUP_ALLOW_PLAINTEXT:-}" != "true" ]]; then
  echo "refusing to write an unencrypted backup: set BACKUP_GPG_RECIPIENT (and BACKUP_GPG_PUBLIC_KEY_FILE), or BACKUP_ALLOW_PLAINTEXT=true for storage encrypted under separate keys" >&2
  false
fi

source "$(dirname "$0")/pg-tools.sh"
use_matching_pg_tools "$DATABASE_URL"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/casino-$stamp.dump"

if [[ -n "$RECIPIENT" ]]; then
  # Check the key before dumping anything, so a bad key never produces a plaintext file.
  keyring="$(mktemp -d)"
  export GNUPGHOME="$keyring"
  if [[ -n "$KEY_FILE" ]]; then gpg --batch --quiet --import "$KEY_FILE"; fi
  gpg --batch --list-keys "$RECIPIENT" > /dev/null
fi

plain="$file"
partial="$file"
pg_dump --format=custom --no-owner --no-privileges --file="$file" --dbname="$DATABASE_URL"
pg_restore --list "$file" > /dev/null # the archive is complete and readable

if [[ -n "$RECIPIENT" ]]; then
  gpg --batch --yes --trust-model always --encrypt --recipient "$RECIPIENT" --output "$file.gpg" "$file"
  rm -f "$file"
  plain=""
  file="$file.gpg"
  # A well-formed OpenPGP message encrypted to a public key (the private key is not here, by design).
  packets="$(gpg --batch --list-packets "$file" 2>/dev/null || true)" # exits non-zero without the private key
  grep -q '^:pubkey enc packet:' <<<"$packets"
else
  plain=""
fi
sum="$(cd "$(dirname "$file")" && sha256sum "$(basename "$file")" | tee "$(basename "$file").sha256" | cut -d' ' -f1)"
bytes="$(stat -c %s "$file")"

if [[ -n "${BACKUP_UPLOAD_COMMAND:-}" ]]; then
  bash -c "$BACKUP_UPLOAD_COMMAND" upload "$file"
  bash -c "$BACKUP_UPLOAD_COMMAND" upload "$file.sha256"
fi

if [[ -n "$RETENTION_DAYS" ]]; then
  [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "BACKUP_RETENTION_DAYS must be a whole number" >&2; false; }
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'casino-*.dump*' -mtime "+$RETENTION_DAYS" -print -delete
fi

record="{\"msg\":\"backup written\",\"file\":\"$(basename "$file")\",\"bytes\":$bytes,\"sha256\":\"$sum\",\"encrypted\":$([[ -n "$RECIPIENT" ]] && echo true || echo false),\"uploaded\":$([[ -n "${BACKUP_UPLOAD_COMMAND:-}" ]] && echo true || echo false),\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
partial=""
if [[ -n "${BACKUP_STATUS_FILE:-}" ]]; then printf '%s\n' "$record" > "$BACKUP_STATUS_FILE"; fi
ping "$HEARTBEAT"
echo "$record"
