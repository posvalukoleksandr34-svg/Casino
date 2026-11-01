# Backups and disaster recovery

The database is the only state Aurovane keeps. It holds accounts, the
virtual-chip ledger, rounds, predictions and the audit log. The app containers
are stateless and can be rebuilt from the repository at the deployed commit.

**What has been verified (on 2026-11-01, in this repository's environment):**
- The hardened Compose stack ran, and the `backup` service wrote an encrypted
  backup.
- That file was copied out of the volume and checked with
  `ops:backup-verify` (checksum, OpenPGP structure, decryption, archive
  contents).
- It was restored with `RESTORE_FROM=… npm run ops:restore-check` into a
  disposable database: migrated, all append-only triggers present,
  reconciliation OK (22 checks, 0 mismatches).
- The same drill passed on the development database (528 accounts, 91,216
  ledger entries).
- CI runs the plain backup → restore → reconcile drill on every push.

**Not verified here:** off-site storage, because no storage provider is
configured; that is the operator's job.

## What a backup is

`scripts/ops/backup.sh` (`npm run ops:backup`, or the Compose `backup` service):

1. **Checks the key first.** The backup public key is imported and checked
   before anything is dumped, so a bad key never produces a file.
2. **Dumps.** A custom-format `pg_dump` (no owners or privileges; `db:migrate`
   re-applies grants after a restore). It runs with umask 077, only reads the
   source, and uses PostgreSQL client tools of the server's major version.
3. **Checks the archive** with `pg_restore --list`.
4. **Encrypts** to `BACKUP_GPG_RECIPIENT` and deletes the plaintext.
   - **Encryption is mandatory.** Without a recipient the script refuses,
     unless `BACKUP_ALLOW_PLAINTEXT=true` is set explicitly; use that only for
     storage that is encrypted at rest under separate keys.
   - If anything fails after the dump, the plaintext and any partial output
     are deleted.
   - Only the **public** key is ever on the server.
5. **Checks integrity.** It confirms a well-formed OpenPGP message encrypted to
   a public key, and writes a `.sha256` file next to it.
6. **Off-site copy** (`BACKUP_UPLOAD_COMMAND`): a command you supply, run with
   the file as `$1`, and again for the `.sha256`. It is provider-neutral: for
   example `rclone copyto "$1" offsite:aurovane/$(basename "$1")`, or
   `aws s3 cp "$1" s3://<bucket>/`. Give the storage credential write-only
   (append) rights, and set object lock / versioning on the bucket so a
   compromised server cannot delete history.
7. **Retention.** `BACKUP_RETENTION_DAYS` (default 35) prunes local copies.
   Off-site retention is the bucket's lifecycle policy.
8. **Monitoring.**
   - `BACKUP_STATUS_FILE` records the last success.
   - `BACKUP_HEARTBEAT_URL` is requested after each success, and
     `BACKUP_FAILURE_URL` (default `<heartbeat>/fail`) after a failure.
   - Point them at a dead-man's-switch monitor that **alerts when no success
     arrives within 26 hours**.
   - The script exits non-zero on failure.

Credentials:
- The backup job reads with the migrator role. The app role cannot read
  backups.
- The backup host never holds the private key.
- No URL, password or key material is printed.

## Set up (Compose)

```bash
# On a trusted workstation (not the server): create the backup key pair.
gpg --quick-gen-key 'Aurovane backups <backups@your.domain>' rsa4096 encr 2y
gpg --armor --export backups@your.domain > deploy/backup/public.asc      # → server
gpg --armor --export-secret-keys backups@your.domain > backup-private.asc # → offline, two places
# .env on the server:
#   BACKUP_GPG_RECIPIENT=backups@your.domain
#   BACKUP_UPLOAD_COMMAND=…   BACKUP_HEARTBEAT_URL=…
docker compose --profile backup up -d backup
docker compose logs backup        # {"msg":"backup written",…,"encrypted":true,…}
```

Store the private key offline, in at least two places (for example an
encrypted USB key in a safe, plus a password manager vault), with its
passphrase recorded separately. **Without it, no backup can be restored.**
Test that you can decrypt with it before you rely on the setup.

The `backup` service waits for migrations, runs every `BACKUP_INTERVAL_HOURS`
(default 24), and keeps going after a failed run (which is reported). It runs
as the unprivileged `postgres` user with a read-only root filesystem and no
capabilities.

## Verify backups regularly

```bash
npm run ops:backup-verify -- /path/casino-<stamp>.dump.gpg
# without the private key: checksum + OpenPGP structure
# with BACKUP_GPG_PRIVATE_KEY_FILE=… (restore workstation): also decrypts and lists the archive
```

At least **monthly**, run a full restore drill on the restore workstation or a
disposable host, using a real backup taken from off-site storage:

```bash
RESTORE_FROM=/path/casino-<stamp>.dump.gpg \
BACKUP_GPG_PRIVATE_KEY_FILE=/secure/backup-private.asc \
RESTORE_ADMIN_URL=postgresql://<admin>@<disposable-host>/postgres \
npm run ops:restore-check
# → RESTORE CHECK PASSED; reconciliation OK, 0 mismatches
```

Record the date, the backup used, the duration and the result. The drill
never touches an existing database: it creates
`casino_restore_check_<time>_<n>` and drops it afterwards.

## Recovery objectives

| | Default setup | Notes |
|---|---|---|
| RPO (data that can be lost) | up to 24 h | lower it with a shorter `BACKUP_INTERVAL_HOURS`, or continuous WAL archiving / a managed database with point-in-time recovery (recommended for a public launch) |
| RTO (time to restore) | about 1 h for this data size | measure it in your drill |

## Disaster recovery runbook

Use this after database loss or corruption, a lost host, or a suspected
compromise.

1. **Stop writes.**
   - Turn on the kill switch under `/admin/risk` if the app still runs. Then
     stop the app: `docker compose stop app`.
   - On a suspected compromise, also rotate the credentials: database roles,
     `SEED_ENCRYPTION_KEY` (via `SEED_ENCRYPTION_KEYS_PREVIOUS`),
     `IP_HASH_SECRET`, `SMTP_URL`, `METRICS_TOKEN`
     ([operations.md §2](operations.md#2-secrets-and-configuration)).
2. **Decide the restore point.** Usually the newest backup that passes
   `ops:backup-verify`. After a compromise, pick the newest one taken before
   it.
3. **Prepare a clean database.** Either a new Compose stack (`docker compose
   up -d db`, which creates the roles on the first start) or a new managed
   instance with the roles from
   [operations.md §4](operations.md#4-database-roles-and-permissions).
4. **Decrypt and restore,** on the restore workstation:

   ```bash
   gpg --output casino.dump --decrypt casino-<stamp>.dump.gpg
   pg_restore --no-owner --no-privileges --exit-on-error \
     --dbname=postgresql://casino_migrator:…@<host>/casino casino.dump
   shred -u casino.dump
   ```

5. **Migrate and re-grant:** `npm run db:migrate`, or
   `docker compose run --rm migrate`. This checks migration checksums,
   re-applies the app role's grants and reference data.
6. **Reconcile.** `npm run job:reconcile` (or `docker compose run --rm migrate
   npm run job:reconcile`) must report `OK, 0 mismatches`. If it does not,
   stop and follow the incident runbook
   ([operations.md §8](operations.md#8-reconciliation-alerts-and-incident-response)).
7. **Start the app** and check:
   - `/api/health/ready` returns 200;
   - you can sign in to `/admin`;
   - `/admin/health` (including e-mail) and `/admin/reconciliation` are
     green.

   Then lift the kill switch.
8. **Communicate.**
   - Tell players what happened and which time the data was restored to.
     Activity after the restore point is lost: rounds, predictions,
     registrations, profile changes.
   - Virtual chips have no monetary value, but explain any balance
     differences honestly.
9. **Record** the timeline, the cause, the restore point, the checks and
   follow-ups. Run a fresh backup immediately, then verify it.

## What backups contain and how long

- Backups contain personal data:
  - e-mail addresses, names, dates of birth, countries and phone numbers;
  - hashed passwords and session token hashes;
  - verification addresses.
- Encryption, access control on the storage, and the retention period are
  part of your privacy obligations. See
  [legal-review-checklist.md](legal-review-checklist.md).
- An account deleted in the app stays in older backups until they expire.
  The Privacy Notice says so.
