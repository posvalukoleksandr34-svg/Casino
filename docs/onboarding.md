# Registration, e-mail verification and onboarding

How a player gets from "Create account" to the lobby, what is stored at each
step, how the server enforces it, and how operators support it. Aurovane uses
free virtual chips only; nothing here involves payments.

## The journey

| Step | Page | What happens | Session? |
|---|---|---|---|
| 1. Create account | `/register` | Username, e-mail, password (twice), 18+ confirmation, acknowledgement that chips are virtual, acceptance of the [Terms](../src/app/terms/page.tsx) and [Privacy Notice](../src/app/privacy/page.tsx). A **pending** account is created and a six-digit code is e-mailed. | No |
| 2. Verify e-mail | `/verify-email` | The player enters the code (paste-friendly, numeric keypad, auto-submits at six digits). They can resend (with a visible cooldown) or correct the address. A correct code **activates** the account and signs them in. | Issued here |
| 3. Your details | `/onboarding` | First and last name, date of birth, country of residence, phone number; optionally a display name and avatar (the existing profile presets). Mandatory for new accounts. | Restricted |
| 4. Lobby | `/lobby?welcome=1` | A one-off welcome message; normal access from here on. | Normal |

A progress indicator (`SignupSteps`) shows all four steps on pages 1–3 and
marks the current one with `aria-current="step"`.

There is no marketing consent: Aurovane sends no marketing messages, so none is
asked for. If marketing is ever added, it must be a separate, unticked,
optional choice.

## Pending accounts (before the code)

Registration (`register()` in `src/server/users/accounts.ts`) inserts the user
row with `email_verified_at = NULL`, records the accepted terms and privacy
versions, writes the audit event `user.registered`, and creates the first code
challenge — all in one transaction. It creates **no** session, wallet, fairness
seeds, play-limits row or welcome chips.

The browser receives an HttpOnly, SameSite=Lax **signup-flow cookie**
(`__Host-aurovane_signup` on HTTPS): an HMAC-signed token naming the pending
account, valid 24 hours. The verification endpoints read the account only from
this cookie; no request ever carries an account id, so nobody can act on
someone else's pending registration. Signing out (or "Start over") clears it.

A pending account cannot sign in normally. With the right password, sign-in
answers `403 EMAIL_NOT_VERIFIED`, sets the flow cookie and sends a fresh code if
none is usable (respecting the limits below); the login form continues on
`/verify-email`. A wrong password gives the usual generic error, so this reveals
nothing about which addresses exist.

A registration that is never verified keeps its e-mail and username for 24
hours. After that, a new registration with the same e-mail or username
**reclaims** them: the stale row is anonymised exactly as a deleted account (it
never had a wallet or activity) and `user.pending_expired` is audited.

## Verification codes

Implemented in `src/server/users/verification.ts`; constants in
`src/lib/account-policy.ts`.

| Property | Value |
|---|---|
| Code | 6 digits from `crypto.randomInt` (CSPRNG) |
| Stored | Only `HMAC-SHA256(key, "<challenge id>:<code>")`; the key is derived from `IP_HASH_SECRET`, so a database copy alone does not allow offline guessing |
| Expiry | 10 minutes |
| Wrong attempts | 5 per code; then the code is dead and a new one is needed |
| Single use | Consumed by a conditional update under the account's row lock; concurrent correct submissions activate once (tested with 6 in parallel) |
| One live code | Issuing a code supersedes the previous one (partial unique index) |
| Resend | Once per 60 s per purpose; at most 5 codes per account per hour; a code whose delivery failed can be replaced at once |
| Rate limits | Code entry 30 / 10 min per IP; new codes 20 / h per IP and 5 / h per address; registrations 10 / h per IP and 5 / h per address (address buckets keyed with HMAC, never the address) |
| Never exposed | The code is only in the e-mail: not in responses, URLs, logs, audit metadata or analytics (there is none) |

**Activation** (on a correct code, one transaction): mark the e-mail verified
(`email_verification_method = 'CODE'`), create the wallet, the provably-fair
seed pair and the play-limits row with the existing services, grant the welcome
chips through the existing ledger-backed bonus (`grantSignupBonus`, unique
business key), audit `user.email_verified`, and create the session. Any failure
rolls everything back.

## Onboarding (after the code)

`src/server/users/onboarding.ts`, page `src/app/onboarding/page.tsx`.

* **Names**: any script's letters and combining marks with spaces, apostrophes
  (`' ’ ʼ`), hyphens and full stops between them; NFC-normalised, whitespace
  collapsed, 1–64 characters. Digits and symbols are refused. They are the
  player's legal name and are never shown to other players.
* **Date of birth**: strict `YYYY-MM-DD` naming a real calendar day; age is
  computed by comparing calendar dates against **today in UTC**, so leap years
  and time zones cannot shift it (a 29 February birthday counts from 1 March in
  common years). Under 18, future dates and ages over 120 are refused **on the
  server**; the form's checks are only a convenience. Because the reference day
  is UTC, a player whose 18th birthday is "today" in a time zone ahead of UTC is
  accepted the next UTC day.
* **Country of residence**: ISO 3166-1 alpha-2 code from `i18n-iso-countries`
  (the 249 assigned codes plus `XK`, Kosovo, which the package includes), names
  from CLDR (`Intl.DisplayNames`). Searchable, keyboard- and touch-operable
  combobox. Never inferred from the IP address. No country is restricted.
* **Phone**: a phone-region selector (the residence country is suggested until
  the player picks one) plus the national number, normalised and validated with
  `libphonenumber-js` (full metadata on the server) and stored as E.164.
  `phone_verified_at` stays NULL — there is no SMS challenge — and every page
  shows the number as unverified.

Submitting stores everything and sets `onboarding_completed_at` in one
transaction, audits `user.onboarding_completed` with the **names of the fields**
(never their values), and sends the player to `/lobby?welcome=1`.

### Enforcement

* `resolveSession` refuses sessions of unverified accounts and marks sessions
  whose onboarding is pending (`onboarding_required AND onboarding_completed_at
  IS NULL`).
* **APIs** (`route()` in `src/server/http/handler.ts`): a pending session gets
  `403 ONBOARDING_REQUIRED` from every route except those declared
  `onboarding: 'allow'`: `/api/onboarding`, `/api/auth/logout`, `/api/auth/me`,
  `/api/account/profile`, `/api/account/export`, `/api/account/password`,
  `/api/account/email*` and `DELETE /api/account`. Routes with optional
  authentication treat a pending session as signed out. An integration test
  calls **every** API route with a pending session; a unit test pins the
  allow-list.
* **Pages**: `requireUser` and `requirePermission` redirect pending players to
  `/onboarding`; public pages use `pageSession()`, which does the same. A unit
  test fails if any page reads the raw session except login, register and
  verify-email. `/onboarding` redirects completed accounts to the lobby, and
  login/register/verify-email send signed-in players to the right step, so
  there are no redirect loops.

## Profile and settings

* `/settings` → **E-mail address**: status (verified, or "not re-verified" for
  legacy accounts) and a change flow: new address + current password → code to
  the **new** address → confirm. The old address stays in use until then. On
  success other sessions and outstanding reset links are revoked and the old
  address receives a notice (with the new address masked).
* `/settings` → **Personal details**: names, country and phone can be edited
  (a changed number stays unverified); the date of birth can be set once and is
  otherwise changed only by support.
* `/profile` shows a private summary (e-mail status, name, country, phone with
  its verification state, completion). The date of birth is shown only in
  Settings.
* Staff: `/admin/users/<id>` shows the registration state; names, birth date,
  country and phone only to roles with `users:pii` (support, admin, owner).

## Data handling

* **Export** (`/api/account/export`) includes the new fields and the list of
  codes sent (when, to which address, whether used) — never a code or verifier.
* **Deletion** erases first and last name, date of birth, country and phone
  along with the existing personal fields, and overwrites the addresses stored
  on verification challenges; ledger, round, prediction and audit records are
  kept in pseudonymised form as before.
* Audit events for this flow carry no codes, names, birth dates, phone numbers
  or addresses (asserted by a test that also captures process output).

## Existing accounts (migration 0009)

* Every account that existed before migration 0009 gets `email_verified_at =
  created_at` and `email_verification_method = 'LEGACY_MIGRATION'`. **This is
  a compatibility assumption so existing players keep signing in — not proof
  that the address was ever verified.** Settings shows such addresses as "not
  re-verified"; changing the address verifies the new one with a code.
* `onboarding_required` is FALSE for them (the column's default switches to
  TRUE only for rows created afterwards): no existing player is forced through
  the profile step, and no personal details are invented. They may add details
  in Settings.
* Sessions, balances, ledger entries, rounds, achievements and predictions are
  untouched (the migration only adds columns, constraints and one table).
* Accounts created by operator scripts (`npm run db:seed`, load tests, e2e
  fixtures) use `createOperatorAccount`: verified as `OPERATOR`, normally exempt
  from onboarding.

**Recovery / rollback.** The migration is forward-only and additive. Before
rolling the application back to a version without this feature, close
registration (`MAIL_TRANSPORT=disabled`) and retire pending registrations, for
example by letting staff anonymise them, because the older version would let a
never-verified account sign in without a wallet. Verified accounts keep
working under the older version: it ignores the new columns and table. A full
rollback is a restore of the pre-migration backup
([operations.md §6](operations.md#6-backups-and-tested-restoration)), which
loses everything written since.

## E-mail delivery

| `MAIL_TRANSPORT` | Registration | Codes |
|---|---|---|
| `smtp` | open | sent through `SMTP_URL` (TLS required for remote hosts) |
| `console` (development only; refused in production) | open | printed to the server console; the page says so |
| `disabled` (default) | **closed** — `503 SERVICE_UNAVAILABLE`, no account created | — |

Codes are sent synchronously after the registering transaction commits, and the
result is recorded on the challenge (`SENT` / `FAILED`). A failure leaves the
account pending; the page says the e-mail could not be sent and offers an
immediate resend. Failures are logged without the recipient, body or code.

Production delivery has **not** been verified in this repository's environment
(no provider is configured). The SMTP path is exercised against a local SMTP
sink in the integration and end-to-end suites. Configure and test your
provider as described in [operations.md §9](operations.md#9-e-mail-delivery-external-provider).

### When a player cannot receive the code

1. Ask them to check spam/promotions and to use "Send a new code" after the
   cooldown (5 codes per hour).
2. If the address was mistyped, "Wrong address? Change it" on the verification
   page corrects it (the code goes to the new address).
3. Check `/admin/health` (transport state) and `casino_mail_failed_total`; look
   for `mail delivery failed` in the logs (purpose `email_verification`).
4. If the provider is down, nothing is lost: the account stays pending and the
   player can request a code once delivery works again. A pending registration
   older than 24 hours can simply be registered again.
5. There is deliberately **no** staff action that marks an address verified
   without a code. If one is ever needed, it must be an audited, reasoned admin
   action, not a database edit.
