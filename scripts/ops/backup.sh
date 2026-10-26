#!/usr/bin/env bash
# Logical backup of the casino database (provider-neutral; docs/operations.md §6).
#
#   DATABASE_URL=postgresql://casino_migrator:…@host/casino \
#   BACKUP_DIR=/var/backups/casino BACKUP_GPG_RECIPIENT=ops@example.org \
#   BACKUP_RETENTION_DAYS=35 npm run ops:backup
#
# * Custom-format pg_dump (no owners or privileges: grants are re-applied by
#   `npm run db:migrate` after a restore), written with umask 077.
# * BACKUP_GPG_RECIPIENT: encrypt to that public key and delete the plaintext,
#   so the backup host and the off-site copy never hold readable data. Without
#   it the dump is plaintext; encrypt at the storage layer instead.
# * A .sha256 file accompanies every dump; BACKUP_RETENTION_DAYS prunes local
#   copies older than that many days (off-site retention is the storage
#   provider's lifecycle policy).
# Read-only against the source database. Never prints the URL.
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL (source database) is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-}"
RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/casino-$stamp.dump"

pg_dump --format=custom --no-owner --no-privileges --file="$file" --dbname="$DATABASE_URL"
pg_restore --list "$file" > /dev/null # the archive is readable

if [[ -n "$RECIPIENT" ]]; then
  gpg --batch --yes --trust-model always --encrypt --recipient "$RECIPIENT" --output "$file.gpg" "$file"
  rm -f "$file"
  file="$file.gpg"
fi
( cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256" )

if [[ -n "$RETENTION_DAYS" ]]; then
  [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "BACKUP_RETENTION_DAYS must be a whole number" >&2; exit 1; }
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'casino-*.dump*' -mtime "+$RETENTION_DAYS" -print -delete
fi

echo "{\"msg\":\"backup written\",\"file\":\"$file\",\"bytes\":$(stat -c %s "$file")}"
