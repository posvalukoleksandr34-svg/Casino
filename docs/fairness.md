# Provably fair protocol

Implementation: `src/engine/rng/provably-fair.ts` (isomorphic), seed management
`src/server/fairness/seeds.ts`, browser verifier `src/engine/verify.ts` + `/fairness`.

## Definitions

* **Server seed** — 32 bytes from the OS CSPRNG (`crypto.randomBytes`), written as 64
  lowercase hex characters. Stored AES-256-GCM-encrypted (`SEED_ENCRYPTION_KEY`, key id in
  the ciphertext for rotation). Never sent to the browser while active.
* **Commitment** — `hex(SHA-256(utf8(serverSeed)))`, shown before any round uses the seed.
* **Client seed** — 1–64 printable ASCII characters chosen by the player (random default).
* **Nonce** — per seed pair counter starting at 0, incremented once per round inside the
  wager transaction. `(seed_pair_id, nonce)` is unique; the nonce can never decrease.

## Byte stream

```
block(i) = HMAC-SHA256(key = utf8(serverSeed), message = utf8(clientSeed + ":" + nonce + ":" + i))   i = 0, 1, 2, …
stream   = block(0) ‖ block(1) ‖ block(2) ‖ …
```

Bytes are consumed strictly in order.

## Mapping bytes to outcomes

* `uint32` — next 4 bytes, big-endian.
* `int(n)` for 1 ≤ n ≤ 2³² — **rejection sampling**: let `limit = 2³² − (2³² mod n)`;
  draw `u = uint32()` until `u < limit`, return `u mod n`. Every value in `[0, n)` is exactly
  equally likely (no modulo bias). Rejections consume extra bytes deterministically, so the
  verifier reproduces them.
* `float()` — 52 bits: `(uint32() >>> 12) · 2³² + uint32()` divided by `2⁵²`, in `[0, 1)`.
* `shuffle(list)` — Fisher–Yates from the end using `int(i + 1)`.

| Game | Outcome |
|---|---|
| Roulette | `pocket = int(37)` |
| Dice | `roll = int(10000)`, displayed as `roll / 100` |
| Crash, Mines, Blackjack, Slots | see each game's document in [math/](math/) |

All randomness for a round is drawn when the round starts. Later player actions
(revealing a tile, hitting, cashing out) are deterministic transitions over that
pre-determined state, so nothing the server does after the wager is accepted can change
the outcome without breaking verification.

## Rotation and disclosure

* A player can rotate at any time (optionally choosing a new client seed). The active seed
  is marked `REVEALED`, its plaintext stored for display, and a new seed is committed.
* Rotation is **refused while a round using the active seed is still open**, because
  revealing the seed would expose that round's predetermined outcome (e.g. mine positions,
  the remaining deck, the crash point).
* Every past round shows its commitment, client seed and nonce; once revealed, the round
  page links to the verifier pre-filled with those inputs.

## Independent verification

1. Check `SHA-256(serverSeed)` equals the commitment you saw before playing.
2. Compute the stream and outcome as above — with the in-browser verifier (no data sent to
   the server) or any HMAC-SHA256 implementation. Example (Node.js):

```js
const { createHmac } = require('node:crypto');
function* bytes(serverSeed, clientSeed, nonce) {
  for (let i = 0; ; i++) yield* createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${i}`).digest();
}
function int(it, n) {
  const limit = 2 ** 32 - (2 ** 32 % n);
  for (;;) {
    let u = 0; for (let k = 0; k < 4; k++) u = u * 256 + it.next().value;
    if (u < limit) return u % n;
  }
}
console.log(int(bytes(serverSeed, clientSeed, nonce), 37)); // roulette pocket
```

Tests: `tests/unit/rng.test.ts` (stream equals Node's HMAC, rejection sampling),
`tests/unit/verify.test.ts` (verifier ≡ engine), `tests/integration/fairness.test.ts`
(commit → play → rotate → verify every round), `tests/statistical/*` (uniformity).

**Per-game inputs.** Limbo uses the Crash mapping; Keno takes the first 10 of a
Fisher–Yates shuffle of 1–40; Plinko takes one `int(2)` per row; Hi-Lo draws every card as
`int(52)` in order (the whole sequence is drawn when the round starts and only turned-over
cards are sent to the browser). The verifier on `/fairness` recomputes all of them.

**Server-side check.** `POST /api/fairness/verify-round` (button "Check this round on the
server" on a round page) recomputes one of the player's own settled rounds with the same
verifier from the revealed seed and compares it with the stored result; it reports a
mismatch rather than hiding it.

**Demo sports results** use a per-event seed committed (SHA-256 published) before
predictions open and revealed with the result; see [sports.md](sports.md#demo-model-and-fairness).

## What this proves — and what it does not

It proves that each outcome was fixed by a seed committed before the wager and was not
changed afterwards, and that the published byte-to-outcome mapping was applied. The
player-chosen client seed prevents the operator from pre-selecting a seed for a known
outcome sequence.

It does **not** prove: that the paytable shown is what is paid (covered by open rules,
tests and reconciliation), that the ledger is correct (covered by reconciliation and
audits), that the operator did not run other code paths (requires independent
certification of the deployed build), or that the CSPRNG is unbiased beyond what the
commitment covers. The statistical tests are sanity checks, not proofs of randomness.
