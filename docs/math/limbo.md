# Limbo — mathematical specification

Implementation: `src/engine/games/limbo`. Tests: `tests/unit/limbo.test.ts`,
`tests/integration/new-games.test.ts`, `tests/statistical/new-games.stat.test.ts`.

## Outcome space

One result multiplier R per round, drawn with exactly the Crash mapping
([crash.md](crash.md)): 52 random bits n (20 bits of one `uint32` and all 32 of the next)
give

  R = max(1.00, ⌊100 · (10000 − h) · 2⁵² / (10000 · (2⁵² − n))⌋ / 100)

with house edge h = 100 basis points (1%) by default. R is drawn before anything is shown
and does not depend on the stake or the target.

## Rules and payout

The player chooses a target T (hundredths; 1.01× ≤ T ≤ 10,000× by default, step 0.01×).
The round pays ⌊stake · T / 100⌋ when R ≥ T (a tie wins) and 0 otherwise.

## RTP

R ≥ T ⟺ 2⁵² − n ≤ (10000 − h) · 2⁵² / (100 · T), so exactly

  P(R ≥ T) = ⌊(10000 − h) · 2⁵² / (100 · T)⌋ / 2⁵²
  RTP(T) = P(R ≥ T) · T / 100 = (1 − h/10⁴) − ε,   0 ≤ ε < T / (100 · 2⁵²)

**RTP ≤ 99% for every target**, verified with exact integer arithmetic for every target
from 1.01× to 100.00× and a sample above (`tests/unit/limbo.test.ts`). The test also
checks the closed form against a binary search over the mapping itself.

| Target | P(win) | RTP | Variance per unit staked |
|---|---|---|---|
| 1.01× | 98.0198% | 99.00% | 0.020 |
| 2.00× | 49.5000% | 99.00% | 1.00 |
| 10.00× | 9.9000% | 99.00% | 8.92 |
| 100.00× | 0.9900% | 99.00% | 98.0 |
| 10,000× | 0.0099% | 99.00% | 9,899 |

Variance per unit staked is T² p (1 − p).

## Maximum payout and limits

Max payout = ⌊stake · T⌋. Default limits: stake 0.10–1,000 chips, per-round payout cap
1,000,000 chips, so targets above 1,000× accept proportionally smaller stakes; the risk
engine refuses a wager whose potential payout exceeds the cap before any money moves.

## Verification

The fairness verifier recomputes R from the revealed server seed, client seed and nonce
(`verifyOutcome('limbo', …)`); it is the same function the server ran.
