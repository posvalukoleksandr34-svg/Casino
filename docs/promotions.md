# Promotions, cashier and community features

Everything here uses **virtual credits**. Credits have no monetary value and cannot be
bought, withdrawn, transferred or exchanged. No payment provider is connected, and no
screen asks for financial information.

## Money model

| Event | Ledger transaction | Postings |
|---|---|---|
| Starting credits on activation | `BONUS_GRANTED` (`bonuses.type = SIGNUP`) | promotions −x, wallet +x |
| Free daily top-up | `BONUS_GRANTED` (`DAILY`) | promotions −x, wallet +x |
| Bonus claimed (welcome offer or promo code) | `BONUS_CLAIMED` | promotions −x, `BONUS_LOCKED` +x |
| Bonus released (wagering met) | `BONUS_RELEASED` | `BONUS_LOCKED` −x, wallet +x |
| Bonus forfeited or expired | `BONUS_FORFEITED` | `BONUS_LOCKED` −x, promotions +x |

- **One wallet.** Each player has one wallet. `BONUS_LOCKED` is a single system account;
  locked credits cannot be wagered.
- **Reconciliation proves two things:**
  - `BONUS_LOCKED` equals the sum of active claims (`bonus_locked_matches_active_claims`);
  - every bonus transaction has exactly the right postings and belongs to exactly one
    claim (`bonus_claims_match_ledger`).

## Campaigns and claims

- **Campaigns (`bonus_campaigns`).** A campaign is a welcome offer (claimed from the
  Promotions page) or a promo code (case-insensitive).
  - **Amount:** `min(max_bonus, fixed_amount + match_percent % of the starting credits)`.
  - **Wagering requirement:** `amount × wagering_multiplier`, at most ×20. 0 means the
    credits are released at once.
  - **Optional limits:** account-age eligibility, a start and end time, a total claim cap.
- **Claims (`bonus_claims`).** Unique per player and campaign; at most one active claim
  per player.
  - A trigger keeps a claim's terms immutable, lets progress only grow, and never
    reopens a closed claim.
  - Claims cannot be deleted or truncated.
- **Wagering.** Every settled casino round adds its whole stake to the active claim,
  inside the settlement transaction. Predictions do not count, voided rounds never count,
  and claims past their deadline do not progress.
- **Expiry.** A scheduler job (`bonus-expiry`, every 5 minutes) closes expired claims.
- **Eligibility.**
  - The account must be active.
  - The player must not be self-excluded or in a cool-off break.
  - The campaign must be active and inside its dates and claim cap.
  - The account must not be older than the campaign allows.
  - The player must not have claimed this campaign before.
- **Default welcome offer** (`welcome`, seeded at bootstrap): 100% of the starting
  credits, at most 20,000 credits, wagered ×1, 30 days to complete, for accounts up to
  30 days old.
  - With the default 10,000 starting credits, a new player can therefore hold 10,000
    credits plus 10,000 locked bonus credits.
  - The starting credits are the "Signup bonus" under Admin → Risk & platform. Set it to
    20,000 for a 20,000 + 20,000 start.
- **Admin (`/admin/promotions`).**
  - Create, pause, resume and end campaigns; view each campaign's claims.
  - Every change is an audited admin action with a reason.
  - Money terms cannot change once a campaign has been claimed.

## Cashier (`/wallet`)

- **Overview:** available, in play (open rounds and predictions), locked bonus, and
  lifetime totals received, wagered, won and refunded, all computed from the ledger.
- **Free top-up:** choose → review → receipt, for the free daily allocation.
- **Bonus:** the active bonus and its progress.
- **Transactions** and **Account activity.**

## Community

- **Levels** (`src/server/users/levels.ts`): cosmetic only. Experience is derived from
  existing records:
  - 2 XP per settled round, at most 30 rounds per UTC day;
  - 40 XP per game tried;
  - 150 XP per achievement.

  Level L+1 needs 50·L·(L+1) XP in total.
- **Leaderboard** (`/leaderboard`): best multiplier this week, and highest level.
  - Only players who switch on "Show my name on leaderboards and the live feed"
    (Settings) are listed. The viewer sees their own standing privately.
  - No prizes, and no board based on volume.
- **Live feed** (`/api/live`): players online, notable wins, the latest table spin. Names
  appear only with the same opt-in; there are no round ids or balances.

## Deliberately not implemented

- **Autoplay, bonus buys, volume-based missions and volume leaderboards.** All of them
  push play volume.
- **Real deposits, card or bank forms, crypto, withdrawals, and any conversion of credits
  to anything of value.**
- **Multiplayer rooms with invitations.** The automatic roulette table is the shared
  multiplayer surface: one schedule for everyone, with live spectator spins. Private
  invite-only rooms were not built in this pass.
