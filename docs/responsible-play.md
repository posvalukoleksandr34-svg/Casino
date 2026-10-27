# Responsible-play controls

What each control enforces, where and how it is tested. These are tools that help
players keep their play within limits they choose; **they do not and cannot guarantee
anyone's safety**, and they do not replace professional help. Signposting to support
services appropriate to each jurisdiction is the operator's responsibility.

All checks run **on the server** in `assertCanWager` (`src/server/responsible/limits.ts`)
inside the wager transaction, **after the player's wallet row is locked** — so parallel
requests, stale browser state and alternative endpoints cannot get around them. Every path
that moves chips out of a player's wallet into play goes through it: starting a round
(`startRound`), every additional stake inside a round (blackjack double / split /
insurance, via `applyStep`) and placing sports predictions (`placeSlip`, whose stakes are
checked together). There is no other wagering endpoint.

| Control | What it enforces | Applies |
|---|---|---|
| **Self-exclusion** (6, 12 or 60 months, or indefinite; typed confirmation) | No new wagers or additional stakes until it ends; no daily chips. Cannot be shortened or lifted by the player (a longer exclusion extends it). | immediately |
| **Cool-off** (24 h, 72 h, 7 days or 30 days) | Same as self-exclusion, for a shorter period. Cannot be shortened. | immediately |
| **24-hour loss limit** | Rejects a wager if *net loss in the last 24 h + this stake* would exceed the limit. | rolling window |
| **7-day loss limit** | Same over 7 days. | rolling window |
| **24-hour wagering limit** | Rejects a wager if *stakes placed in the last 24 h + this stake* would exceed the limit. | rolling window |
| **Session time limit** | Rejects wagers once the current **login session** is older than the chosen minutes. Signing in again starts a new session. | per session |
| **Reality check** | Periodic reminder (player-chosen interval) of minutes signed in, and of chips wagered and net result over the last 24 hours, with a link to take a break (informational; does not block). | per session |
| **Tightening vs loosening** | Adding or lowering a limit applies immediately. Raising or removing one is queued and applies only after 24 hours; each loosening request waits its own full 24 hours (a later request does not inherit an earlier one's time). | — |

**Window definitions** (`playTotals`): net loss = stakes placed in the window − payouts
received in the window, over casino rounds and sports predictions together. Stakes of rounds
and predictions that were voided (and therefore refunded in full) are excluded, as are
rejected predictions (no chips moved). An open prediction counts as lost until it settles. The stake of a round that is still open counts as lost until it settles,
which errs on the side of the limit.

**Finishing open rounds.** Limits, breaks and the platform kill switch block *new*
wagers. They never prevent a player from finishing a round already in progress (revealing
a tile, cashing out, standing), so no one is forced to forfeit a stake.

**Other protective defaults.** Per-player balance cap (100,000,000 chips; wagers that could
exceed it are rejected), a daily top-up only while the balance is low (and never during a
break), no deposits, purchases or cash-outs at all.

## Evidence

* `tests/integration/responsible.test.ts` — loss (deterministic, via a test-only seed
  oracle), wager and session limits; immediate tightening and delayed loosening; cool-off
  and self-exclusion block wagers and cannot be shortened.
* `tests/integration/responsible-hardening.test.ts` — parallel wagers cannot jointly exceed
  a wagering limit (exactly 3 of 10 × 300 accepted under a 1,000 limit); later loosening
  waits its own 24 h; voided rounds do not count; no daily chips during breaks; the kill
  switch stops new rounds but lets players finish open ones.

## Known limitations

* Session limits are per login session; a player can start a new session.
* Limits are per account; there is no cross-account or cross-operator exclusion register.
* Breaks and exclusions do not delete the account or block signing in (players can still
  see balances, history and finish open rounds).
