# Video slots — mathematical specification

Implementation: `src/engine/games/slots` (`engine.ts` is the game, `machines.ts` the three
reel sets). Tests: `tests/unit/slots.test.ts`, `tests/integration/slots.test.ts` and
`tests/statistical/slots.stat.test.ts`.

The three machines are **Lantern Hollow**, **Ember Fruits** and **Sands of Aurum**. Their
themes, symbols, art (inline SVG), sounds and maths are original to Aurovane. No
third-party game, artwork or name is used.

## Outcome space

- **Reels.** Five reels; each is a circular strip of symbols (41–47 stops). A spin draws
  one stop per reel from the round's provably fair stream, `nextInt(strip length)`, in
  reel order. Each reel then shows the 4 consecutive symbols from that stop (wrapping
  round). Every stop is equally likely, so a spin has ∏ Lᵢ equally likely outcomes:
  140–220 million per machine.
- **Free spins.** These draw five more stops each, from the same stream and in order.
  The whole round therefore follows from the seed pair and the nonce.

## Rules and payout

- **Ways.** A paying symbol wins when it (or the wild) appears on reels 1, 2, 3, … in a
  row from the left, in any row. For a run of k ≥ 3 reels the win is
  `pay(symbol, k) × ∏ᵢ<k countᵢ`, where countᵢ is how many times the symbol or the wild
  shows on reel i. Wins of different symbols add up. There are at most 4⁵ = 1,024 ways.
- **Wild.** Reels 2–5 only. It substitutes for every paying symbol (not the scatter) and
  pays nothing on its own.
- **Scatter.** 3, 4 or 5+ scatters anywhere in the base spin award N₃, N₄ or N₅ free
  spins. These are played at once on the same reels, with every win multiplied by m.
  Free spins cannot retrigger.
- **Units and payout.** Pays are hundredths of the stake per way. The round pays
  `⌊stake × total / 100⌋`, where total is the base win plus every free-spin win.
- **Excluded by design.** There is no autoplay and no bonus buy. One wager is placed and
  settled once.

## Exact analysis

`analyseMachine` computes, without simulation:

- **Mean and variance of a spin.** A spin's win is a sum of terms
  `pay(s, k) · ∏ᵢ φᵢ(window on reel i)`, one per symbol s and run length k:
  - φᵢ is the count of s (or the wild) for i < k;
  - φᵢ is `[none]` for i = k < 5;
  - φᵢ is 1 after that.

  Reels are independent, so E[B] and E[B²] factorise into per-reel sums over stops. The
  sum of B over all combinations is an exact integer (`BigInt`).
- **Scatter coupling.** The distribution of the scatter count Z and E[B·1{Z = n}] come
  from multiplying per-reel polynomials in the scatter count.
- **Round mean and RTP.** With free spins worth F (Nₙ spins, independent of the base
  spin):
  - `E[X] = μ + Σₙ P(Z=n) Nₙ m μ`;
  - `RTP = ΣB · (T + m Σₙ Cₙ Nₙ) / (100 · T²)` as an exact fraction, where T is the
    number of combinations and Cₙ the number with Z = n.
- **Round variance.** `E[X²] = E[B²] + 2 Σₙ E[B·1{Z=n}] Nₙ m μ + Σₙ P(Z=n) m² (Nₙ σ² + Nₙ² μ²)`.
- **Largest win.** Found exactly by a depth-first search over reel windows, with an
  admissible bound: a running symbol can at best continue with the largest count each
  remaining reel offers, because pays never fall with a longer run.
  The largest round is `max over n of [largest spin with Z = n] + Nₙ · m · [largest spin]`.
- **Hit frequency.** The same search, pruned as soon as a win is certain or impossible.

**How this is tested.** A unit test checks every figure against brute-force enumeration
of every stop combination, on a fixed small machine and on six random ones. The figures
compared are the mean, variance, trigger probability, maximum spin, maximum round, hit
frequency and the exact RTP fraction. The configuration schema refuses any machine whose
RTP is not strictly below 100% or whose largest win exceeds the platform's 100,000× cap.

## Figures (default configurations)

| | Lantern Hollow | Ember Fruits | Sands of Aurum |
|---|---|---|---|
| Strip lengths | 43, 45, 45, 45, 45 | 45, 47, 47, 47, 47 | 41, 43, 43, 43, 43 |
| Exact RTP | 96.4492% | 96.1845% | 96.1374% |
| House edge | 3.5508% | 3.8155% | 3.8626% |
| Spin pays anything | 41.38% | 35.09% | 39.42% |
| Free spins (3 / 4 / 5 scatters) | 8 / 10 / 15 at ×2 | 6 / 8 / 10 at ×2 | 10 / 12 / 15 at ×2 |
| Free spins awarded | 1 in 159.2 | 1 in 180.4 | 1 in 139.6 |
| Share of RTP from free spins | 9.24% | 6.33% | 12.64% |
| Largest spin win | 180.22× | 291.66× | 159.64× |
| Largest round win | 5,533.25× | 5,863.44× | 4,813.52× |
| Standard deviation per round | 3.238× | 3.438× | 3.230× |

The exact RTP fractions are:
- Lantern Hollow: 249893211444874496 / 259093057060546875;
- Ember Fruits: 386484175827638272 / 401815462417216875;
- Sands of Aurum: 472223833471879776 / 491196616666182025.

**Limits.** Every machine has a stake of 0.10–100 chips and a per-round cap of 1,000,000
chips. 100 chips × the largest round win stays under that cap, so a stake is never
refused because of its theoretical maximum. A test checks this.

**Rounding.** Payouts are rounded down to 0.01 chip, which can only lower the realised
return at small stakes. The figures above are at the multiplier level, as for every
other game.

## Statistical checks

`tests/statistical/slots.stat.test.ts` plays 150,000 rounds per machine from fixed seeds
and checks:
- uniform reel stops (chi-square, α = 0.001);
- RTP within a 99.9% interval of the exact value, using the exact standard deviation;
- the free-spin rate and the hit frequency within 99.9% intervals;
- no round above the exact maximum;
- the sample variance within a factor of 2 of the exact one (the tail is heavy).
