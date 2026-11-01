#!/usr/bin/env bash
# Verifies a backup file without restoring it (docs/backup-recovery.md):
#
#   npm run ops:backup-verify -- /var/backups/casino/casino-20261101T020000Z.dump.gpg
#
# 1. The .sha256 next to the file matches.
# 2. Encrypted files: a well-formed OpenPGP message. If a private key is
#    available (BACKUP_GPG_PRIVATE_KEY_FILE, or a GNUPGHOME that holds it —
#    normally only on the offline restore workstation), the file is decrypted
#    into a private temporary directory and its archive table of contents read
#    (pg_restore --list); the plaintext is deleted afterwards.
# For a full restore of the file into a disposable database plus
# reconciliation, use: RESTORE_FROM=<file> npm run ops:restore-check
set -euo pipefail
umask 077
file="${1:?usage: backup-verify.sh <backup file>}"
[[ -f "$file" ]] || { echo "no such file" >&2; exit 1; }
[[ -f "$file.sha256" ]] || { echo "missing $file.sha256" >&2; exit 1; }
( cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256" )
echo "ok checksum"
if [[ "$file" == *.gpg ]]; then
  packets="$(gpg --batch --list-packets "$file" 2>/dev/null || true)" # non-zero exit without the private key
  grep -q '^:pubkey enc packet:' <<<"$packets" || { echo "not an OpenPGP message encrypted to a public key" >&2; exit 1; }
  echo "ok OpenPGP structure"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  if [[ -n "${BACKUP_GPG_PRIVATE_KEY_FILE:-}" ]]; then
    export GNUPGHOME="$work/gnupg"; mkdir -m 700 "$GNUPGHOME"
    gpg --batch --quiet --import "$BACKUP_GPG_PRIVATE_KEY_FILE"
  fi
  if gpg --batch --quiet --output "$work/plain.dump" --decrypt "$file" 2>/dev/null; then
    pg_restore --list "$work/plain.dump" > /dev/null
    echo "ok decrypts and the archive is readable ($(pg_restore --list "$work/plain.dump" | grep -c ' TABLE DATA ') tables with data)"
  else
    echo "note: no decryption key here — checksum and structure verified only (decrypt on the restore workstation)"
  fi
else
  pg_restore --list "$file" > /dev/null
  echo "ok archive is readable"
fi
