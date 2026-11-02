# Cashier, payments, verification and support

This document describes the cashier (deposits and withdrawals), identity verification
(KYC), support tickets, notifications and VIP tiers, and lists **exactly what an authorised
operator must supply** before any real money could be processed.

> **There is no live payment provider in this code base.** The only provider is a sandbox
> simulator. `PAYMENTS_MODE` is `disabled` by default in production and `sandbox` by
> default in development. Nothing in this repository charges a card, moves a bank
> transfer or pays anyone. The default currency is `CHIP` (virtual credits with no
> monetary value). Real-money gambling requires a licence in every jurisdiction where it
> is offered; this repository makes no claim of compliance anywhere.

## Modes

| `PAYMENTS_MODE` | Deposits / withdrawals | Webhooks | Default |
|---|---|---|---|
| `disabled` | refused with a clear message | answered `503`, nothing applied | production |
| `sandbox` | simulated provider: test checkout, signed webhooks, simulated payouts | verified and applied | development, e2e |

There is deliberately no `live` value: `PAYMENTS_MODE=live` fails configuration
validation at start-up (`tests/unit/env.test.ts`). In production, `sandbox` requires
`PAYMENTS_SANDBOX_SECRET` (32+ characters).

`PLATFORM_CURRENCY` (`CHIP`, `EUR`, `CHF`, `USD`, `GBP`) only changes labels: one currency
per deployment, amounts are integer minor units everywhere.

## Money flow and the ledger

All balances live in the existing double-entry ledger (`ledger_accounts`,
`ledger_entries`, `ledger_transactions`). Each player has exactly one wallet. Three system
accounts were added (migration 0013):

| Account | Meaning |
|---|---|
| `SYSTEM:PENDING_WITHDRAWALS` | amounts requested for withdrawal and not yet paid, rejected, cancelled or failed |
| `SYSTEM:PAYMENT_CLEARING` | the provider's side: money received from / sent to the provider (may go negative) |
| `SYSTEM:PAYMENT_FEES` | fees kept by the platform |

| Transaction | Postings |
|---|---|
| `DEPOSIT` | clearing −amount, wallet +(amount − fee), fees +fee |
| `WITHDRAWAL_HOLD` | wallet −amount, pending +amount |
| `WITHDRAWAL_PAID` | pending −amount, clearing +payout, fees +fee |
| `WITHDRAWAL_RELEASED` | pending −amount, wallet +amount (rejected, cancelled or failed) |

Reconciliation (`src/server/jobs/reconciliation.ts`) checks, in addition to the existing
checks:

* `pending_withdrawals_match_open` — the pending account equals the open withdrawals;
* `deposits_match_ledger` — `DEPOSIT` transactions and completed deposits correspond
  one-to-one with exactly the expected postings;
* `withdrawals_match_ledger` — each withdrawal has one hold and, when closed, one matching
  paid or released transaction, and nothing else.

`tests/integration/payments.test.ts` injects faults (a wallet credited as a "deposit" with no
deposit, held money moved back silently, an undeclared fee) and shows each is detected.

## Deposits

```
CREATED → PENDING (player sent to the provider) → COMPLETED | FAILED | CANCELLED | EXPIRED
                                                 ↘ UNDER_REVIEW (provider reported another amount/currency)
```

* `POST /api/cashier/deposits` (Idempotency-Key) validates the method, its limits, the
  player's and the site's deposit limits, self-exclusion and cool-off, computes the fee and
  starts the payment with the provider. **It does not credit anything.**
* The wallet is credited **only** by a verified settlement webhook (below), in the same
  transaction as the ledger posting and the event log row. A browser "success" page never
  credits: the return page (`/wallet/deposits/:id`) only shows the status the server knows.
* A settlement for a different amount or currency puts the deposit `UNDER_REVIEW`; staff
  can close it as failed but **cannot credit it by hand** (the operator refunds through the
  provider).
* A matching settlement that arrives after the deposit expired or was abandoned is credited
  (the money did arrive), audited as `payment.late_settlement_credited`.
* Unpaid deposits expire (`depositExpiryMinutes`, job `deposit-expiry`).
* Deposit limits: the stricter of the site limit (cashier settings) and the player's own
  24-hour / 30-day limits (Responsible play page; lowering applies at once, raising after
  24 hours). Requested, pending and completed deposits count.

## Withdrawals

```
REQUESTED → APPROVED → PROCESSING → COMPLETED
          ↘ UNDER_REVIEW → (one or two approvals) → APPROVED … | REJECTED
Player may cancel until the payout is sent; a failed payout is FAILED.
REJECTED, CANCELLED, FAILED return the full amount to the wallet.
```

* The amount leaves the spendable balance immediately (`WITHDRAWAL_HOLD`), so it cannot be
  wagered while the withdrawal is pending.
* Every condition is computed by the server and shown to the player with where to fix it:
  identity verification (once), account status, cooldown, daily / 30-day limits, method
  minimum and maximum, balance, and the **closed-loop rule** (withdraw to a method the
  player has completed a deposit with — an anti-money-laundering rule the operator can
  switch off). No deposit is ever required to unlock money the player already has beyond
  establishing that method; withdrawing does not forfeit a bonus in progress.
* Review: amounts at or above `reviewThreshold` (0 = all), and every withdrawal of an
  account with an **open compliance risk flag**, wait for finance. Amounts at or above
  `dualApprovalThreshold` need **two different approvers**. Nobody can decide their own
  withdrawal, and the first approver cannot give the second approval (application check and
  database constraints).
* Approved withdrawals are sent to the provider; the payout completes or fails by signed
  webhook. In sandbox mode staff can settle a payout as paid or failed from Admin →
  Payments, and the `sandbox-payouts` job completes payouts after a minute.

## Webhooks

`POST /api/payments/webhooks/:provider` is public and server-to-server. It is authenticated
by the provider's signature over the **raw body**, not by a session, so the browser
same-origin check does not apply to it (route option `origin: 'signed'`).

Sandbox signature: header `Aurovane-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.

Processing (`src/server/payments/webhooks.ts`):

1. the adapter verifies the signature (constant-time) and the timestamp (±5 minutes);
2. rejected deliveries are logged (`payment_events.signature_valid = false`, first 500
   bytes only) and change nothing (`400`);
3. an advisory lock on `(provider, event id)` serialises duplicate deliveries; an event id
   already applied answers `200 {duplicate: true}` and changes nothing;
4. the event is applied and logged in one transaction (unique index on verified event ids).

`payment_events` is append-only (database trigger). Tested: replay of the same event,
concurrent duplicates, a second settlement event with a new id, forged signature, tampered
body, stale timestamp, unknown provider, amount mismatch, disabled mode.

## Bonuses on deposits

Bonus campaigns of kind `DEPOSIT` (first, second, third … deposit, or `deposit_number`
NULL for a reload) with a minimum deposit, a match percentage capped at a maximum, a
wagering multiple, an expiry, a **maximum stake that counts** while wagering, and **per-game
contribution percentages**. The player opts in explicitly; every term is shown before they
confirm. The bonus is granted only when the deposit settles, re-checking eligibility, and is
locked in `BONUS_LOCKED` until its wagering is met (docs/promotions.md). The deposit itself
is never locked.

## Identity verification (KYC)

```
NOT_STARTED → (upload required documents, submit) → PENDING → VERIFIED | REJECTED
REJECTED → (upload again, submit) → PENDING
```

* Required: identity document (front) and proof of address. Optional: back, selfie, other.
* **Uploading never changes the status**, and the page says so. Only a compliance reviewer
  (`kyc:review`) who is not the player can verify or reject; the reason is shown to the
  player and every decision is in the append-only `kyc_reviews` log and the admin audit.
* There is no automated identity provider: `src/server/kyc/provider.ts` defines the
  interface; the only implementation is manual review.
* Compliance can add **risk flags** (document mismatch, multiple accounts, chargeback, bonus
  abuse, source of funds, other). An open flag sends every withdrawal of the account to
  manual review; resolving it needs a written resolution.

## Private uploads

Identity documents and support attachments (`src/server/storage/private-files.ts`):

* accepted only when the **bytes** are JPEG, PNG or PDF (declared type and file name are
  not trusted), at most 5 MB; PDFs containing JavaScript, launch actions, embedded files
  or forms are refused; file names are reduced to a safe base name with the real extension;
* stored under `UPLOAD_DIR` (never under `public/`) with a random name, directory mode 700,
  file mode 600; the database keeps metadata, a SHA-256 and the storage key;
* served only through authenticated routes to the owner or authorised staff, as
  attachments with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src
  'none'; sandbox` and `Cache-Control: private, no-store`; staff downloads of identity
  documents are audited.

Docker Compose mounts a named volume `uploads` at `/var/lib/aurovane/uploads`. **Back it up
with the database** — the backup job in this repository covers PostgreSQL only.

## Support, notifications, VIP

* **Support tickets** (`/support`): topic, subject, message, optional attachment; staff
  (`support:manage`) reply, add internal notes the player never sees, assign, resolve or
  close. Messages and attachments are append-only. Priority tickets (VIP perk) are listed
  first.
* **Notifications** (`/notifications`, header bell): deposits, withdrawals, bonuses, VIP,
  verification, support and security. E-mail copies are sent by the `notification-mail`
  job after the transaction that created them commits; players choose which kinds are
  e-mailed (security is always on). Notifications never contain passwords, codes the player
  did not ask for, or the content of support messages.
* **VIP tiers** (`/vip`): Bronze → Diamond by lifetime casino wagering, never lost. Perks
  are enforced in code and nothing else is promised: a larger daily free top-up and
  priority support. Thresholds and perks are edited in Admin → VIP tiers
  (`promotions:manage`), audited, and must increase from tier to tier.

## Rewards and tournaments

* **Rewards** (`/rewards`): weekly VIP cashback (the tier's percentage of the previous ISO
  week's net casino loss — stakes minus payouts of settled rounds — from a minimum loss,
  capped), a birthday reward (once a year), a one-off reward on first reaching each VIP tier,
  and tournament prizes. The server creates each reward once per player and period
  (`player_rewards` unique key); the player claims it, which posts `REWARD_CREDITED`
  (promotions → wallet) once; reconciliation `rewards_match_ledger` checks the pairing.
  Rewards are wager-free, expire if unclaimed, and are neither created for nor claimable by
  suspended, self-excluded or cooling-off accounts. Amounts and rules are edited in Admin →
  VIP & rewards (`promotions:manage`), audited.
* **Tournaments** (`/tournaments`): a player joins; settled rounds after joining, inside the
  window, in the listed games and at or above the minimum stake are scored from the round
  records. The metrics rank luck, not volume (best single-round multiplier, or the sum of
  the three best), so playing more is not rewarded. VIP-only tournaments are possible. Names
  appear only for players who opted in to public names. When the window ends a job writes
  the results once (append-only) and creates prizes as rewards. Cancelled tournaments pay
  nothing. Created and cancelled in Admin → Tournaments, audited.

## Roles

| Role | Payments | Verification | Support |
|---|---|---|---|
| Owner, Admin | read, review, configure | review | manage |
| Finance manager | read, review (approve/reject withdrawals, close deposits under review) | — | — |
| Compliance manager | read | review, risk flags | — |
| Auditor | read | — | — |
| Support agent (`SUPPORT`) | — | — | manage |
| Game & risk manager (`RISK_MANAGER`) | — | — | — |

## What an authorised operator must supply before real money

None of the following exists in this repository. Each item is required, not optional.

1. **Licence and legal review** for every jurisdiction served (remote gambling licence,
   terms, privacy notice, AML/CTF policy, responsible-gambling programme), and the
   regulator's technical standards (RNG certification, game testing, reporting).
2. **A payment provider contract** and a **provider adapter** implementing
   `PaymentProvider` (`src/server/payments/providers/types.ts`): `startDeposit`,
   `startPayout`, `verifyWebhook` with the provider's real signature scheme, registered in
   `providers/index.ts`, plus payment methods configured in Admin → Payments. A live mode
   must be added deliberately to `PAYMENTS_MODE` with its own configuration checks — the
   code does not contain one.
3. **Provider credentials and webhook secrets** in a secret manager (never in the
   repository), rotated per the provider's guidance; webhook endpoint allow-listing if the
   provider publishes source addresses.
4. **Refunds and chargebacks**: the adapter has no refund or chargeback events; they need
   new event types, ledger postings and reconciliation checks.
5. **An identity-verification provider** (document and liveness checks, sanctions/PEP
   screening) implementing `IdentityProvider`, with its results recorded as reviewable
   decisions; age verification at registration where the regulator requires it.
6. **AML transaction monitoring** (thresholds, velocity rules, source-of-funds workflows,
   suspicious-activity reporting) beyond the manual risk flags here.
7. **Shared, encrypted object storage** for uploads when running more than one app
   instance, with a retention and deletion policy for identity documents.
8. **Production e-mail** (SMTP provider, SPF/DKIM/DMARC) for notifications.
9. **Tax, accounting and regulatory reporting** from the ledger.
10. **Independent security testing** (penetration test) of the cashier, webhooks and
    uploads (docs/penetration-testing.md), and a review of the four-eyes thresholds.

## Not implemented (known gaps)

* Live payment processing of any kind; refunds; chargebacks; crypto.
* Automated KYC, sanctions/PEP screening, AML monitoring.
* Free-spin bonuses (slots have in-game free spins only). A full content-management system:
  announcements and banners are managed in Admin → Content; help articles and legal pages
  remain in code and change through a reviewed release.
* Virus scanning of uploads (content sniffing and PDF active-content checks only).
* Upload storage for multi-instance deployments (local disk only).
