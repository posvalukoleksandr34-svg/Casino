# Owner administration (back office)

The back office lives at `/admin`. It is part of the same Next.js application, uses the
same database and ledger, and adds no second balance system. Chips are virtual: they have
no monetary value and cannot be bought, sold, transferred or withdrawn. Nothing in the back
office moves real money, and figures are labelled as virtual chip movement, never as
revenue or profit.

Every page and every API route checks its own permission on the server
(`requirePermission` for pages, the `route()` wrapper for APIs). Navigation is filtered by
role for convenience only. Staff-only pages answer **404** to accounts without access, and
APIs answer 401/403. Refusals of signed-in accounts are written to the audit log as
`security.access_denied` (at most 20 per account per 10 minutes).

## Routes

| Route | What it does | Permission |
|---|---|---|
| `/admin` | Dashboard for a period (today, 7 days, 30 days, custom UTC range): accounts, new accounts, active players, recently active sessions, rounds, chips wagered / paid out / house net (casino and sports), bonuses, test-chip grants, corrections, daily charts, most played games, recent registrations and rounds, system health, items needing attention | `admin:access` |
| `/admin/users` | Search (username, display name, id; e-mail only with `users:pii`), filters (status, role, registration dates), sorting, pagination | `users:read` |
| `/admin/users/:id` | Profile, balance with ledger check, rounds, wallet entries, sports summary, sessions, security events, administrative history, responsible-play settings; actions the viewer is allowed (suspend/reinstate, sign out everywhere, change role, grant chips, correction) | `users:read` (+ per action) |
| `/admin/ledger` | Read-only ledger browser (type, player, transaction #, dates; keyset pagination), totals per type, system account balances | `ledger:read` |
| `/admin/ledger/:id` | One transaction: entries with balance-after and sequence, links to player, round or prediction, the audited admin action behind it | `ledger:read` |
| `/admin/games`, `/admin/games/:id` | Every catalogued game: status (active / maintenance / disabled), stake and risk limits, published return, configuration versions and change history, activity per period, recent rounds, overdue settlements | `admin:access` (+ `games:manage`, `risk:manage` to change) |
| `/admin/rounds`, `/admin/rounds/:id` | Rounds by game, status, player; void (refund) of open rounds | `rounds:read`, `rounds:void` |
| `/admin/sports`, `/admin/sports/events/:id` | Provider health, open liability, events; per event: prices, predictions by selection, result versions, settlement history, operator actions; suspend/resume, prediction window, record/correct result with settlement preview, void; schedule demo fixtures | `admin:access` (+ `sports:manage` to change) |
| `/admin/risk` | Platform kill switch, exposure and reserve limits, bonuses, house funding | `admin:access` (+ `risk:manage`, `house:fund`) |
| `/admin/reconciliation`, `/admin/alerts`, `/admin/health` | Ledger reconciliation runs (22 checks), alerts, readiness and errors | `system:read` |
| `/admin/audit` | Audit log search: action prefix, actor (username or id), target, outcome, dates | `audit:read` |
| `/admin/security` | Your two-factor authentication; for owners the staff MFA policy and who has MFA on | `admin:access` (policy: `security:manage`) |

APIs under `/api/admin/*` mirror these pages ([api.md](api.md)). Every state change
needs a written reason (5–500 characters), runs in one database transaction with its audit
record and is rate-limited per staff member.

## Roles and permissions

| Permission | Owner | Admin | Support agent (`SUPPORT`) | Game & risk manager | Finance manager | Compliance manager | Auditor | Player |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `admin:access`, `users:read`, `rounds:read`, `ledger:read`, `analytics:read`, `system:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `users:pii` (see e-mail addresses) | ✓ | ✓ | ✓ | | | ✓ | | |
| `users:suspend` (suspend, reinstate, sign out everywhere) | ✓ | ✓ | ✓ | | | ✓ | | |
| `roles:manage` (roles below admin) | ✓ | ✓ | | | | | | |
| `roles:manage_admins` (grant/remove admin and owner) | ✓ | | | | | | | |
| `rounds:void`, `games:manage`, `sports:manage`, `risk:manage`, `system:operate` | ✓ | ✓ | | ✓ | | | | |
| `audit:read` | ✓ | ✓ | | | | ✓ | ✓ | |
| `ledger:adjust` (compensating corrections) | ✓ | ✓ | | | | | | |
| `ledger:grant` (virtual test chips) | ✓ | | | | | | | |
| `house:fund` | ✓ | | | | | | | |
| `security:manage` (staff MFA policy) | ✓ | | | | | | | |
| `promotions:manage` (bonus campaigns, VIP tiers) | ✓ | ✓ | | | | | | |
| `payments:read` (deposits, withdrawals, provider events) | ✓ | ✓ | | | ✓ | ✓ | ✓ | |
| `payments:review` (decide withdrawals, close deposits under review) | ✓ | ✓ | | | ✓ | | | |
| `payments:configure` (cashier rules, payment methods) | ✓ | ✓ | | | | | | |
| `kyc:review` (identity decisions, risk flags) | ✓ | ✓ | | | | ✓ | | |
| `support:manage` (support tickets) | ✓ | ✓ | ✓ | | | | | |
| `content:manage` (reserved; no content editor yet) | ✓ | ✓ | | | | | | |

The role model maps owner / admin / specialist / player onto: `OWNER`, `ADMIN`, `SUPPORT`
(shown as *Support agent*), `RISK_MANAGER` (shown as *Game & risk manager*),
`FINANCE_MANAGER`, `COMPLIANCE_MANAGER`, `AUDITOR` and `PLAYER`. Finance, compliance and
support decisions are separated: nobody can decide their own withdrawal, verification or
ticket, and large withdrawals need two different approvers ([payments](payments.md)). Source: `src/server/auth/rbac.ts`
(`tests/unit/owner-admin.test.ts`).

**Who may act on whom** (`canManageUser`, `assignableRoles`): staff act only on accounts of
a lower rank (player < specialist staff (support, game & risk, finance, compliance, auditor) < admin < owner); owners may act on
other owners. Only owners grant or remove the admin and owner roles. Nobody changes their
own role or status. A role change signs the account out so new permissions apply at the
next sign-in. The actor's role is re-read under a row lock, not taken from the session.

**The last active owner** cannot be demoted, suspended or deleted. Every role or status
change locks all owner rows (and the actor and target) in one order, so two owners demoting
each other at the same moment cannot both succeed. A database trigger
(`users_keep_an_owner`, migration 0008) refuses the change for any caller, including direct
SQL.

## First owner

Public registration always creates players (the registration schema is strict; a `role`
field is rejected). The first owner is provisioned by an operator with database access:

1. Register the owner's account normally on the site (with a strong, unique password),
   enter the e-mailed code and complete the profile step ([onboarding.md](onboarding.md)).
   Provisioning refuses an account whose e-mail is not verified yet.
2. Promote it from the command line:

   ```bash
   npm run admin:provision-owner -- --email owner@your.domain --reason "Initial owner"
   # Docker Compose (tools image, migration credentials):
   docker compose run --rm migrate npm run admin:provision-owner -- --email owner@your.domain --reason "Initial owner"
   ```

   The script never creates accounts or sets passwords. It refuses unknown or inactive
   accounts, and refuses while an active owner exists. It signs the account out everywhere
   and writes an `owner.provisioned` audit record (actor `SYSTEM`).
3. Sign in, open `/admin/security`, turn on two-factor authentication, then require it for
   staff.
4. Appoint further owners and admins from the user page (owner only).

**Recovery when every owner has lost access** (break-glass): `--break-glass` promotes an
account even though an owner exists. It is audited with `breakGlass: true`; review it
afterwards. If a lost owner must also be demoted while still the only active owner, the
`users_keep_an_owner` trigger must be disabled for that one statement by the migration
owner (`ALTER TABLE users DISABLE TRIGGER users_keep_an_owner; UPDATE …; ALTER TABLE users
ENABLE TRIGGER users_keep_an_owner;`). Record why in your incident log.

## Two-factor authentication (TOTP)

* Any account can turn it on in `/admin/security` (staff). It uses standard authenticator
  apps: RFC 6238, SHA-1, 30-second steps, 6 digits. The secret is shown once as text and
  as an `otpauth://` link; no third-party QR service is used. It is stored encrypted with
  the seed key ring (`SEED_ENCRYPTION_KEY`).
* A code is accepted at most once, with ±1 step for clock drift. Ten single-use recovery
  codes are shown once; only their SHA-256 is stored.
* Sign-in becomes two steps: the password step answers `MFA_REQUIRED` with a signed
  challenge valid for 5 minutes (HMAC keyed from `IP_HASH_SECRET`), and the code step
  issues the session. Code attempts are limited to 5 per account per 5 minutes.
* **Staff policy:** an owner can require MFA for all staff. An owner can only turn the
  requirement on after enabling MFA and signing in with it. While it is on, staff sessions
  that have not passed the second factor can open only `/admin/security`, and every admin
  API answers 403 with `mfaRequired: true`. Players are not affected.
* Turning MFA on signs out every other session. Turning it off needs a valid code and
  clears the verified mark on every session.

## Virtual chips: grants, corrections, house funding

All three post new, balanced, append-only ledger transactions. They never edit entries,
and never accept a resulting balance from the client: the browser sends an amount and a
reason, and the server computes the balance. Each one is idempotent per staff member and
`Idempotency-Key`: a retry with the same key replays the original response, and the same
key with different data is refused (409). Each runs in one transaction with its audited
admin action, so either both exist or neither does.

| Operation | Who | Ledger | Limits |
|---|---|---|---|
| Grant test chips | owner; **a second owner approves above 10,000 chips** | `CHIP_GRANT`: promotions −x, wallet +x | 0.01–1,000,000 chips per grant, active accounts only, never above the player balance cap, never during a player's cool-off or self-exclusion |
| Correction | admin, owner; **always approved by a second admin or owner** | `ADJUSTMENT`: adjustments ∓x, wallet ±x (optionally referencing the corrected transaction) | the wallet may never go negative |
| House funding | owner; **always approved by a second owner** | `HOUSE_FUNDING`: issuance −x, house +x | positive |

Reconciliation (`admin_money_movements_audited`) checks that every such transaction was
made by an identified staff member and has exactly one matching audited admin action with
the same amount. The user page re-derives the wallet balance from its entries and flags a
difference.

## Four-eyes approvals

Sensitive operations need two people. The request is created through the normal
dialog (`/admin/users/<id>`, `/admin/risk`, `/admin/security`): the API answers 202
`{approvalRequired: true, request}`, and nothing changes yet. A second staff member
with the same permission decides it under **Admin → Approvals**. The navigation shows
how many requests are waiting.

| Action | Requires approval | Approver needs |
|---|---|---|
| `ledger.grant` | grants above 10,000 chips (`GRANT_APPROVAL_THRESHOLD`) | `ledger:grant` (owner) |
| `ledger.adjustment` | every correction | `ledger:adjust` (admin, owner) |
| `house.fund` | every funding | `house:fund` (owner) |
| `security.staff_mfa_disable` | switching the staff MFA requirement **off** (switching it on is immediate) | `security:manage` (owner) |

Rules, all enforced on the server (`src/server/admin/approvals.ts`, migration 0010):
- **Who decides:**
  - Nobody approves or rejects their own request. The service refuses it, and
    so does a database CHECK.
  - The requester may cancel their own request.
  - A rejection needs a written reason.
- **How it executes:**
  - Approval executes the operation in the same transaction as the decision,
    under a row lock, with a ledger key derived from the request id. Two
    approvers clicking at once execute it once.
  - The operation runs as the **requester**, whose permission is re-checked
    at that moment. A requester demoted in the meantime cannot have it
    executed.
  - If execution fails (for example a debit that no longer fits the balance),
    nothing is posted and the request closes as `FAILED`.
- **Lifecycle:**
  - Requests expire after 24 hours.
  - A decided request is immutable: a database trigger refuses any change or
    deletion.
- **Audit:** every stage (requested, approved, rejected, cancelled, expired,
  failed) is an audited admin action. The money operation itself keeps its
  usual audit record, which reconciliation checks.

A deployment with one owner cannot fund the house, make large grants or relax
the MFA policy. Appoint a second owner before launch. Immediate on purpose
(routine, or needed in an incident): grants up to the threshold, suspensions,
session revocation, role changes (owner-only, audited, sessions revoked), game
status and limits, the platform kill switch, sports operations.

## Games

* **Status:** *active*; *maintenance* (`SUSPENDED`): no new rounds, open rounds can still be
  finished; *disabled*: as maintenance and hidden from the lobby. Pausing a game with open
  rounds needs explicit confirmation, which the server requires (`confirmOpenRounds`).
  Status never changes outcomes or payouts.
* **Limits** (minimum/maximum stake, maximum payout per round, game exposure) are checked
  by the risk engine before every wager. They must satisfy: minimum stake ≥ 0.01 chip,
  maximum stake ≤ 100,000 chips, maximum stake ≤ maximum payout ≤ 10,000,000 chips,
  maximum payout ≤ game exposure ≤ the platform exposure limit.
* **Configuration (RTP and payout tables):** the player-facing rules, payout tables and
  return figures are generated from each game's published reference configuration and
  checked by tests. The server accepts only that configuration, so an administrator can
  restore it but cannot activate maths that players were not shown. Changing a game's
  mathematics is a code change that regenerates the rules and re-runs the maths tests
  (`docs/math/`). Settled rounds are never altered; each references the configuration
  version it was played under.
* There is no way to influence an individual player's outcomes: outcomes come from the
  player's provably fair seeds, and the risk engine never sees who is playing.

## Sports prediction simulator

* Operators can suspend or resume an event, and set a **prediction window**: an opening
  time and an earlier closing time. Placement enforces the window, and the close is never
  later than kick-off.
* Operators can record or correct a result (a score, only after kick-off) or void an event.
  The dialog shows a **settlement preview** computed by the server with the settlement
  rules: tickets won, lost and void, and the chips that would be credited. Recording the
  current result again changes nothing. Settlement is per (ticket, result version) with
  unique keys, so nothing is paid twice. Corrections are credit-only.
* In demo mode operators can **schedule extra fictional fixtures**. Prices come from the
  published demo model and the result from a seed committed at creation, so operators
  cannot set odds or choose a winner. Fixtures are labelled as demo everywhere.
* Odds and winners are never taken from the client. The admin result API takes scores
  only; any other field is rejected.

## Audit log policy

* **Recorded:** sign-ins and failures, lockouts, MFA events, password changes and resets,
  account deletion, data export, responsible-play changes, seed rotation; for staff,
  every state change with actor, the actor's role at the time, action, target, before and
  after values, reason, request id and hashed IP; refused staff access (`DENIED`) and
  failed second-factor attempts (`FAILED`); owner provisioning (`SYSTEM`).
* **Never recorded:** passwords, password hashes, session tokens or cookies, reset tokens,
  MFA secrets or codes, recovery codes, API keys, or whole request bodies. The logger
  also redacts keys that look like secrets.
* **Integrity:** `audit_logs` and `admin_actions` are append-only for the application.
  Database triggers refuse UPDATE, DELETE and TRUNCATE, and the runtime role has only
  SELECT and INSERT. This is **not** tamper-proof against a database superuser or the
  schema owner, who can disable triggers. Keep those credentials separate, and rely on
  off-site encrypted backups ([operations.md](operations.md#6-backups-and-tested-restoration))
  for an independent copy.
* **Access:** `audit:read` (auditor, admin, owner). Each staff member's own page shows the
  administrative history of an account; it does not expose other secrets.
* **Retention:** audit rows are kept for as long as the database exists, and the
  application deletes nothing. To archive, export ranges with
  `pg_dump --table=audit_logs --table=admin_actions` (or `COPY … TO`) into your encrypted
  backup storage. Pruning old rows would need a deliberate, reviewed migration and is not
  provided. Operational tables are pruned by the cleanup job: sessions 30 days after
  expiry, idempotency keys after 2 days, rate-limit buckets after 1 day.

## Dashboard definitions

All periods are UTC and half-open `[from, to)`. *Today* runs from 00:00 UTC; 7 and 30 days
are rolling windows ending now; custom ranges include both dates (at most 366 days).

* **Active players:** accounts that started a round or placed an accepted prediction in
  the period.
* **Recently active:** accounts with a signed-in request in the last 5 minutes. Sessions
  record activity at most once a minute, so this approximates current use. There is no
  real-time presence tracking.
* **Chips wagered:** stakes of casino rounds settled in the period plus stakes of
  predictions placed in it.
* **Paid out:** casino payouts plus prediction credits (including void refunds) in the
  period.
* **House net (virtual):** wagered − paid out. This is chip movement, not revenue.

Every figure is an aggregate SQL query over recorded rows (`src/server/admin/overview.ts`).
Nothing is simulated or hard-coded.

## Known limitations

* MFA is TOTP only (no WebAuthn/passkeys). Recovery codes are the only fallback.
  Losing both requires the break-glass procedure above.
* Four-eyes approval covers large grants, corrections, house funding and relaxing the
  staff MFA policy (above); role changes and the kill switch stay single-person (audited).
  The dashboard's *Needs attention* list covers alerts, overdue rounds, lagging
  predictions and failed reconciliation.
* Admin pages render on the server without per-section streaming; large ranges
  (≤ 366 days) are aggregated in SQL but are not cached.
* Game mathematics cannot be tuned from the back office (by design, see above). Stake
  limits can.
