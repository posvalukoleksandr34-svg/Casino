# Compliance checklist

**This repository makes no claim of licensing, certification or legal compliance in any
jurisdiction.** It records which technical controls exist (with where they are enforced
and tested) and which legal or organisational items remain for the operator. Whether a
free-to-play virtual-currency casino needs a licence, and which consumer-protection,
advertising, age and data-protection rules apply, depends on the jurisdiction and must be
assessed by qualified counsel.

Legend: **Done** = implemented and tested here · **Operator** = requires the deploying
organisation · **Open** = not implemented.

## Virtual-currency scope

| Item | Status | Where |
|---|---|---|
| Chips have no monetary value and cannot be bought, sold, transferred or cashed out | Done | No payment, transfer or withdrawal code exists; ledger has no external accounts; footer/terms disclosures |
| No real-money deposits, crypto, purchases or prizes of value | Done | Same; nothing in the codebase accepts payment details |
| Clear disclosure on landing page, registration and footer | Done | `src/app/page.tsx`, registration form, `site-footer` |
| Review whether "social casino" rules apply (e.g. if chips are ever sold) | Operator | Selling chips would change the legal analysis entirely |
| Sports predictions use virtual chips only; no real-money wagering, no cash prizes | Done | `docs/sports.md`; same ledger, no external accounts |
| Achievements are cosmetic only (no value, no rewards, nothing for losses or volume) | Done | `src/server/achievements/achievements.ts`, `tests/integration/profile-achievements.test.ts` |
| Review whether a sports *prediction* product (even free-to-play) is regulated or needs provider licences for data display | Operator | depends on jurisdiction and on the providers' terms |

## Players

| Item | Status | Where |
|---|---|---|
| Age confirmation (18+) and terms acceptance at registration | Done (self-declaration) | `register` schema requires both; accepted terms and privacy versions are recorded |
| Date of birth with a server-side 18+ check | Done (self-declared date) | onboarding, `docs/onboarding.md` |
| Age **verification** (documents / provider) | Open / Operator | not implemented |
| E-mail verification | Done | six-digit codes at registration and on address change (`docs/onboarding.md`); pre-existing accounts marked `LEGACY_MIGRATION` without proof |
| Phone verification | Open | numbers stored and shown as unverified |
| Account deletion with retention of financial and audit records | Done | `deleteAccount` anonymises the profile; ledger/audit kept |
| Data export (portability) | Done | `/settings` → export, `exportUserData` |
| Privacy notice, cookie notice, lawful bases, DPA with processors | Operator | `/privacy` and `/terms` describe how the software handles data (not legally reviewed); two first-party HttpOnly cookies (session, signup flow) |

## Fair play

| Item | Status | Where |
|---|---|---|
| Published rules, payout tables and RTP for every game, tested against the engine | Done | `src/content/games.ts`, `tests/unit/content.test.ts`, `docs/math/*` |
| Exact vs estimated RTP clearly distinguished (blackjack is a simulation estimate with CI) | Done | "≈" marks, `docs/math/blackjack.md` |
| Provably fair RNG, browser verifier, server seed revealed only after use | Done | `docs/fairness.md`, `/fairness` |
| No per-player odds, no outcome-dependent acceptance | Done | `src/server/risk/evaluate.ts` takes no player identity; risk decided before randomness |
| No deceptive UI (fake wins, near-miss effects, fake activity) | Done | design rules in `docs/product-spec.md`; no such components exist |
| Sports odds never taken from the client; demo fixtures and odds labelled as demo; no fabricated live data | Done | `src/server/sports/tickets.ts`, `tests/integration/sports.test.ts`, `docs/sports.md` |
| Sports data provider terms (display rights, attribution, quotas) | Operator | live mode is off by default |
| Independent RNG / game-math certification by an accredited lab | Operator | required before any regulated use |

## Responsible play

See `docs/responsible-play.md` for exactly what each control enforces.

| Item | Status |
|---|---|
| Loss, wager and session limits; cool-off; self-exclusion; delayed loosening | Done (server-enforced, tested; casino and sports together) |
| Reality checks and session time display | Done |
| Help resources and signposting appropriate to the jurisdiction | Operator |

## Operations and security

| Item | Status | Where |
|---|---|---|
| Double-entry, append-only ledger with independent reconciliation | Done | `docs/database.md` |
| Audited admin actions with reason, before/after, atomic with the change | Done | `recordAdminAction`, admin tests |
| Least-privilege database role; separate migration owner | Done | migration 0004, `docs/operations.md` §4 |
| TLS, secret management, backups, monitoring | Operator | `docs/operations.md` |
| Password-recovery e-mail provider | Operator | `docs/operations.md` §9 |
| Penetration test | Open / Operator | |
| Incident response procedure | Done (documented) | `docs/operations.md` §8 |
| Staff roles, owner provisioning, last-owner protection, staff MFA policy | Done | `docs/admin.md`, `tests/integration/owner-admin.test.ts` |
| Audit log of staff actions (actor, role, reason, before/after), refused access logged | Done (append-only for the app; not tamper-proof against a DB superuser) | `docs/admin.md` § Audit log policy |
| Four-eyes approval for chip grants and corrections | Open | not implemented |
