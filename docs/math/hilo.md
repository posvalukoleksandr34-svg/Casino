# Hi-Lo — mathematical specification

Implementation: `src/engine/games/hilo`. Tests: `tests/unit/hilo.test.ts`,
`tests/integration/new-games.test.ts`, `tests/statistical/new-games.stat.test.ts`.

## Card distribution

Every card is an independent `int(52)` from the provably fair stream (an "infinite
deck": as if the deck were reshuffled before every card). Card c has rank ⌊c/4⌋ + 1
(Ace = 1 low … King = 13 high) and suit c mod 4 (cosmetic). Each rank has probability
4/52 = 1/13 for every card, independently of all other cards.

When the round starts the server draws the whole sequence the round can use,
L = 1 + G + S cards, where S is the skip limit (52) and G = 88 bounds the number of
guesses before the cap (below). The sequence is stored server-side; the client only ever
receives cards that have been turned over. Decisions cannot change which cards come:
the i-th card used is always sequence[i].

## Rules

From current rank r, the player may:

* guess **higher** (wins iff the next rank is strictly greater; success chance
  a/13 with a = 13 − r; impossible on a King),
* guess **lower** (strictly smaller; a = r − 1; impossible on an Ace),
* **skip** (the next card becomes current; multiplier unchanged; at most 52 per round),
* **cash out**, after at least one correct guess.

An equal rank loses, whatever the guess (chance 1/13).

## Multiplier

After k correct guesses with success numerators a₁ … a_k:

  M_k = min(⌊(10000 − h) · 13^k / (a₁ ⋯ a_k)⌋, cap) / 10⁴

(exact BigInt arithmetic; h = 100, cap = 10,000,000 = 1,000×). The house edge is
applied once; each later guess multiplies by exactly 13/a. Reaching the cap cashes out
automatically. A wrong guess pays 0. Cash-out pays ⌊stake · M_k⌋.

## RTP for every strategy

Let F_k = 13^k / (a₁ ⋯ a_k) (the fair multiplier) and A_k the event that the first k
guesses were all right. Given any history, the next guess succeeds with probability
exactly a/13 (cards are independent and uniform), so

  E[F_{k+1} · 1{A_{k+1}} | history] = F_k · (13/a) · (a/13) · 1{A_k} = F_k · 1{A_k}

and a skip leaves F and A unchanged. So F · 1{A} is a martingale with value 1 before
the first guess. Every strategy stops by a bounded time (at most G guesses before the
cap, at most S skips), so by optional stopping E[F_T · 1{A_T}] = 1. The payout is
⌊(1 − h) · F_T⌋ (possibly capped) times 1{A_T} ≤ (1 − h) · F_T · 1{A_T}. Hence
**E[payout] ≤ 99% of the stake for every strategy**: any guesses, skips and cash-out
point. Rounding down and the cap only lower it.

The unit tests check this independently by exhaustive search for the optimal strategy
with up to 4 guesses and 3 skips (optimal return ≤ 99%), and compute the exact RTP of
"guess the likelier side, cash out after k" for k = 1…6 two ways (engine and
`scripts/sim/independent-rtp.ts`):

| k | Exact RTP |
|---|---|
| 1 | 98.99893% |
| 2 | 98.99822% |
| 3 | 98.99846% |
| 5 | 98.99924% |

First-guess multipliers: Ace higher / King lower 1.0725× (92.31%); 7 either way 2.1450×
(46.15%); Queen higher / 2 lower 12.8700× (7.69%). The full table is on the game's rules
page.

## Sequence length bound

Each correct guess multiplies the uncapped multiplier by 13/a ≥ 13/12, so after k
correct guesses M ≥ 0.99 · (13/12)^k, which reaches 1,000× by k = 87. The engine uses
G = ⌈ln(cap / (10000 − h)) / ln(13/12)⌉ + 1 = 88 and L = 1 + 88 + 52 = 141 cards; the
unit tests verify the bound for several caps and play rounds that skip every allowed
card.

## Maximum payout and limits

Max payout = stake × 1,000×. Default limits: stake 0.10–1,000 chips, per-round cap
1,000,000 chips. The risk engine reserves the cap as open exposure while a round is open.
Open rounds never expire; seeds cannot be rotated while one is open.

## Analytics treatment

Like Mines, the stored expectation and variance are those of the fixed path the player
actually took ("make exactly these guesses, then cash out"), whose expectation is 99%
of the stake up to the 4-decimal floor.

## Verification

`verifyOutcome('hilo', …, { cards })` lists the sequence's first cards from the revealed
seeds; the round link fills in how many the round used.
