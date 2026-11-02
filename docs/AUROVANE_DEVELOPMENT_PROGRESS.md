# Aurovane development progress — casino platform pass

This log covers the "complete casino platform" pass, which started on 2026-11-02. It
continues `docs/AUTONOMOUS_DEVELOPMENT_PROGRESS.md`, which covers batches 1–13: the design
system, game stages and slots. Each batch is committed with its test results.

**Boundaries that hold throughout.**
- Every balance, top-up, bonus, wager and payout is virtual credits. Credits have no
  monetary value and cannot be bought, withdrawn, transferred or exchanged.
- No payment provider, card form, bank, crypto or cash-out is connected or imitated.
- Outcomes and balances are decided on the server only.

## Audit (before changes)

Already in place and kept:
- **Money:**
  - one wallet per player on a double-entry ledger, with strict reconciliation (32
    checks);
  - idempotent rounds, server-authoritative games, a stake reserved before the outcome,
    settlement exactly once, and exactly-once refunds on void;
  - responsible-play limits enforced on the server.
- **Admin:** users, restrictions (suspend), chip grants and adjustments with four-eyes
  approval, game configuration, round inspection and void, audit log, security events,
  reconciliation, risk, health and sports.
- **Games:** 9 table and instant games and 5 slots, provably fair; the lobby has search,
  categories, favourites and recently played.

Missing, and addressed in this pass:
- campaigns and promo codes;
- bonus balance and wagering progress;
- a cashier;
- a promotions page;
- levels and leaderboards;
- a live feed;
- a casino-style home page and navigation;
- admin campaign management.

## Decisions

- **Bonus balance without a second wallet.**
  - Claimed bonus credits sit in one system account, `BONUS_LOCKED`. The player still has
    exactly one wallet.
  - A bonus is released to the wallet when the stakes settled since the claim reach its
    wagering requirement. It returns to promotions on expiry or forfeit.
  - Reconciliation proves `BONUS_LOCKED` = the sum of active claims, and that every bonus
    transaction has exactly the right postings.
- **Moderate defaults.** The welcome offer is 100% of the starting credits, up to 20,000,
  wagered ×1, with 30 days to use it. Without withdrawals, a high wagering multiple would
  only push play volume. Admins can configure campaigns, within the database limits
  (×20 at most).
- **No payment imitation.** The cashier's "top-up" is the existing free daily allocation,
  presented as a step-by-step flow. It is labelled free virtual credits everywhere and
  never asks for financial details.

## Batches

### P1. Bonus engine (done)

- **Migration `0012_promotions.sql`** (additive only):
  - account type `BONUS_LOCKED`;
  - transaction types `BONUS_CLAIMED`, `BONUS_RELEASED`, `BONUS_FORFEITED`;
  - table `bonus_campaigns` (welcome or promo code, match % or fixed amount, cap, wagering
    multiple, expiry, account-age eligibility, schedule, claim cap) with CHECK
    constraints;
  - table `bonus_claims`: unique per player and campaign; at most one active per player;
    a guard trigger keeps terms immutable, lets progress only grow, never reopens a
    closed claim, and blocks deletion and truncation.
- **Service** (`src/server/promotions/campaigns.ts`):
  - claim by welcome-offer id or promo code (case-insensitive);
  - eligibility: active, scheduled, account age, account status, claim cap, not
    self-excluded and not in cool-off;
  - wagering is counted inside the settlement transaction of every casino round; expired
    claims never progress;
  - release, forfeit, and an expiry job every 5 minutes.
  - Lock order is the platform's: the player's wallet, then the campaign or claim row,
    then system accounts by rank (`BONUS_LOCKED` is rank 7).
- **APIs:** `GET /api/promotions`, `POST /api/promotions/claim` (promo-code attempts are
  rate-limited to 10 per 10 minutes), `POST /api/promotions/forfeit`,
  `GET /api/wallet/summary` (available, reserved in play, locked bonus, lifetime totals,
  all from the ledger).
- **Reconciliation:** two new checks, `bonus_locked_matches_active_claims` and
  `bonus_claims_match_ledger`.
- **Tests:** `tests/integration/promotions.test.ts`, 10 tests:
  - welcome match, locking, progress and release;
  - a concurrent triple claim (exactly one succeeds);
  - eligibility: account age, cool-off;
  - promo codes: case, per-player, cap, one active at a time;
  - zero-wagering immediate release; ended and inactive codes;
  - forfeit; expiry (no progress after the deadline);
  - an interactive round counts once, at settlement;
  - database guards;
  - injected ledger faults caught by both new checks.
- **Results:** integration 316 passed (33 files); unit 354 passed; lint clean.

## Next

- P2: cashier page, promotions page, navigation, casino home page.
- P3: levels, leaderboards, live feed, admin campaign management.
- P4: security review of the new endpoints, end-to-end journeys, full verification.
