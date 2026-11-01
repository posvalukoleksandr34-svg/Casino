# Casino experience: sound, roulette table and results history

This document covers the presentation layer added to the games:

- shared sound effects;
- the idle roulette wheel;
- physical chips, the bet toolbar and automatic clearing;
- the roulette results history.

**None of it touches game outcomes.** Results, payouts, the RNG, game
mathematics, the ledger, limits, responsible-play checks, idempotency and
provably-fair verification are unchanged and stay on the server. Chips remain
free and virtual.

## 1. Sound

### Architecture

| Part | File | Role |
|---|---|---|
| Profiles | `src/lib/audio/profiles.ts` | Per game: each cue's file, level, cooldown, voice limit and switch (effects or ambience) |
| Manager | `src/lib/audio/audio-manager.ts` | One shared Web Audio manager per page: unlock, loading, playback, settings |
| Cue rules | `src/lib/audio/cues.ts` | Pure functions that turn two consecutive server views of a round into cues (Mines, Hi-Lo, Blackjack, Crash) |
| Hooks | `src/components/games/use-game-audio.ts` | `useGameAudio(profile)`, `useAudioSettings()`, `useRoundCues()` |
| Controls | `src/components/games/sound-controls.tsx` | Sound on/off, volume, effects, ambience, shown in the header of every game page |

### Behaviour

- **No autoplay.** No `AudioContext` exists until the first pointer, touch or
  key interaction on a game page. Sound never starts on page load. The idle
  roulette wheel is silent.
- **Lazy, scoped loading.** A game page fetches only its own profile's files,
  and only while sound is on. When the player leaves, its sounds stop, loops
  end and its decoded buffers are released.
- **No duplicates or pile-ups.** Each cue has:
  - a cooldown, so a callback that fires twice plays once;
  - a voice limit, after which the oldest voice is cut.
- **Never in the way.** Every manager call catches its own errors. In each of
  these cases the game plays on silently (unit and e2e tested):
  - a missing file;
  - a blocked request;
  - a decode error;
  - a browser without Web Audio.
- **Background tabs.** The context is suspended while the page is hidden.

### Settings

Settings are stored in this browser only, in `localStorage` under the key
`aurovane:audio:v1`.

| Setting | Default | Effect |
|---|---|---|
| Sound | on | Master switch |
| Master volume | 60% | Overall level |
| Game effects | on, 100% | One-shot cues and action loops (e.g. the rolling ball); own switch and own level |
| Ambience | on, 70% | Background loops (the rising tension in Crash); own switch and own level |

All controls have labels and tooltips and can be operated by keyboard. The
panel closes with Escape and returns focus to its button.

### Profiles

Every game has its own pitches and textures:

| Game | Cues | When they play |
|---|---|---|
| Roulette | chip place, chip remove, countdown warning, "no more bets", wheel spin, ball rolling (loop), pocket ticks, win, lose | Chip actions and toolbar; one tick per second for the last 3 seconds, only with chips on the table; bets sent; wheel start; ball on the track; each pocket the dropping ball passes; result after landing |
| Dice | roll, land, result / win | Count-up start; reveal |
| Mines | select, safe, explosion, cash-out | Tile or start click; server reveal; cash-out |
| Crash | launch, rise (ambience loop; its rate follows the multiplier), cash-out, crash | Round start; while flying; cash-out; bust (also when found by polling) |
| Blackjack | chip, shuffle, deal, flip, win, lose | Deal; each card; hole card revealed; settlement (a push is silent) |
| Limbo | launch, rise, result / win | Count-up start; reveal |
| Keno | draw, land, hit (rising pitch per hit), miss | Draw start; reveal |
| Plinko | drop, peg (each row), slot, win | Replay of the server's stored path |
| Hi-Lo | reveal, correct, incorrect, cash-out | First card; each guess or skip; cash-out |

Cues follow the server's answer or the reveal animation; they never run ahead
of a result. Restoring an open round after a reload is silent: only changes
the player causes, or later steps of a round, are sounded.

### Assets: origin and licence

All 43 files in `public/audio/` are **original works**.

- **How they are made.** The project's own deterministic synthesiser
  (`scripts/audio/synth.ts`) renders one recipe per file
  (`scripts/audio/sounds.ts`). It uses oscillators, seeded noise, biquad
  filters and envelopes. **No recordings, samples, sound libraries or casino
  audio** are used.
- **Proof of origin.** `public/audio/manifest.json` records each file's
  SHA-256. `tests/unit/audio-assets.test.ts` re-renders every recipe and fails
  if a committed file differs from it.
- **Regenerating.** Run `npm run audio:generate`. Add `-- --check` to compare
  only.
- **Format.** WAV, 16-bit PCM, mono, 22,050 Hz. The longest file is 3 s and
  the set totals about 1.1 MiB; a page downloads only its own game's files.
- **Licence.** The same as the repository (proprietary, owned by the
  repository owner); see `public/audio/LICENSE.md`.

## 2. Roulette

### The automatic table

Roulette runs as a continuous table. There is **no Spin button**.

| Phase | What happens | Ends when |
|---|---|---|
| `BETTING_OPEN` | A 15-second countdown (`BETTING_SECONDS` in `roulette-cycle.ts`). The player places, removes, undoes, repeats and doubles chips; the board, total stake and balance update at once. A soft tick sounds in the last 3 seconds, only with chips on the table | The countdown reaches 0 |
| `BETTING_CLOSED` | "No more bets": the board is frozen. **With a valid, non-empty board**, the board is sent once through the existing round API and the wheel winds up. **With no bets (or bets that cannot be placed)**, nothing is sent and nothing is deducted; after 2.5 s the next window opens | The server returns the round, or the request fails |
| `SPINNING` | The wheel carries its current speed into the spin and stops exactly on the server's pocket | The wheel lands |
| `RESULT_REVEAL` | The board is cleared. The number, its colour, each position's win or loss, stake, payout and net are shown; the balance is applied; history is refreshed; the win or lose cue plays. Betting stays locked | 5 s have passed; the next window then opens on its own, empty |
| `RECOVERY` | The request was interrupted. The bets stay on the table, locked, and no new window opens. The player retries safely (same idempotency key) or discards | A retry returns the round (→ `SPINNING`), or nothing is outstanding any more (→ a new window) |

**Design**

- **A pure state machine.** `src/components/games/roulette-cycle.ts`
  (`reduceCycle`) is the only place phases change. Every event is accepted
  in exactly one phase and otherwise ignored, so a timer or animation
  callback that fires twice cannot advance the cycle twice, and two phases
  can never hold at once.
- **One timer.** `use-roulette-cycle.ts` drives it with a single 200 ms
  interval and the page's visibility events. Both are removed on unmount.
- **Absolute deadlines.** Deadlines are monotonic timestamps
  (`performance.now()`), so a throttled or late timer only notices a
  deadline later. It can never skip a phase or add time.
- **Hidden tab.** An open window **pauses** while the page is hidden and
  resumes with at least 5 s left, so bets never close unseen.
- **Leaving the page.** The interval stops, and nothing is sent afterwards.
  This is covered by an end-to-end test.

**Wagering safety**

- **Only the player's own chips are sent.** A wager goes out only for a
  board the player built in that window. Each window starts empty, and Rebet
  is a button the player presses.
- **Checked at the moment of sending.** The board is re-checked when it is
  sent. If it changed or became invalid, nothing is sent
  (`WAGER_SKIPPED`).
- **One request per window.** Each window's wager is sent once
  (`sentWindow` ref). The request uses `useRound`, with its idempotency key,
  safe retries and pending-request record.
- **A refused wager is held, not repeated.** If the server definitively
  refuses a wager (e.g. a responsible-play limit or insufficient funds), the
  bets stay on the table **held**. They are not re-sent every window until
  the player changes them or confirms them ("Use these bets next round"). A
  discarded interrupted request is held the same way, and the balance is
  refreshed.
- **The backend stays authoritative.** Results, payouts, balance checks,
  table limits, responsible-play checks, idempotency and provably-fair
  verification are those of the existing `POST /api/games/roulette/rounds`.
  The client never draws a number. A window without a wager shows no
  number at all.

### Wheel

- **Idle.** The wheel turns slowly (9°/s) while bets are placed. This is
  decorative only: no request, no chips, no number.
- **Wind-up.** When betting closes on a wager, the wheel eases up to
  140°/s while the server answers.
- **The real spin.** It starts when the server's round arrives and is a
  cubic Hermite curve. It starts at the wheel's current speed, so the
  hand-over from idle or wind-up is seamless, and ends at rest after at
  least five turns, exactly on the server's pocket. The ball circles the
  other way, drops into the pockets (pocket ticks) and comes to rest in the
  winning pocket.
- **After landing.** The result is held, then the wheel eases back into
  idle, carrying the ball in its pocket.
- **Rendering and clean-up.** `requestAnimationFrame` writes straight to the
  SVG, so there is no React render per frame. A safety timer settles the
  spin if frames stop, and unmounting cancels both.
- **Reduced motion.** With the system setting or the account's preference
  there is no idle motion or wind-up, and a result is shown at once.
- **Tests.** `wheel-motion.ts` is unit-tested: every pocket lands from any
  start angle and speed, the motion is monotonic, and the start speed is
  continuous.

### Coverage preview on the table

Hovering, focusing (keyboard) or tapping (touch) a position highlights every
number it covers. The covered numbers glow with a bright border; the other
numbers are shaded.

- **Source of the mapping.** `coveredNumbers()` in `roulette-board.ts` is
  computed from the engine's own `betWins()`, the rule that settles real
  rounds. A unit test checks the preview against `betWins` for every
  pocket.
- **What is covered:**
  - each column covers its 12 numbers;
  - the dozens cover 1–12, 13–24 and 25–36;
  - red, black, odd, even, 1–18 and 19–36 cover theirs, and zero is never
    one of them;
  - a straight bet covers one number.
- **Active bets stay visible.** Their chip stacks remain fully visible
  above the shading. Each number shows one small gold dot per active bet
  that covers it (up to three, then "+"), and its accessible name says
  "covered by N of your bets", so overlapping bets are readable. The
  previewed position has its own gold outline, distinct from placed chips.
- **Touch.** The first tap on a position previews it without betting; a
  second tap places a chip. Tapping outside the table clears the preview.
- **Mouse.** Leaving the table clears the preview.

### Chips

There are six denominations, each with a physical colour:

| Denomination | 1 | 5 | 25 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|---|
| Colour | white | red | green | black | purple | orange |

- **Selector.** The selected chip is raised and outlined. The selector is a
  radio group with a label on each chip.
- **On the table.** Chips stack on their position in placement order. The top
  chip shows the position's total, and each position's label states the
  total and the denominations (e.g. "55.00 chips placed (2×25, 1×5)").
- **What is sent.** The client keeps the breakdown per position
  (`src/components/games/roulette-board.ts`). The server receives the same
  payload as before: one bet per position, whose `amount` is the sum of its
  chips. The board test checks this payload against the server's own schema.

### Toolbar

| Control | Action |
|---|---|
| Undo (↺) | Reverts the last change: a placement, removal, Clear, Rebet or 2× |
| Clear (bin) | Removes every chip |
| Remove chips (chip with minus) | Toggle. While on, tapping a position takes its top chip off. This is the touch-friendly way to remove a bet |
| Rebet | Places the last settled spin's combination again, chip for chip |
| 2× | Doubles every stack. Unavailable when the doubled board would exceed the balance, the table maximum, the payout cap or the position limit; the tooltip says why |

Every control:

- has an accessible name and a tooltip;
- is focusable even when unavailable (`aria-disabled`), with the reason in the
  tooltip;
- has hover, focus and pressed states.

A chip can also be removed by right-clicking a position or by pressing
Delete or Backspace while the position has focus.

### Automatic clearing

- **When.** Only after the server has settled the round **and** the wheel
  has landed. The wheel reports each round id once, and the screen also
  ignores repeats. Then:
  1. the deferred balance is applied;
  2. the result and payout are shown;
  3. the combination is kept for Rebet;
  4. the chips, the total and the positions are cleared.

  Winning and losing spins are cleared alike.
- **Never cleared:**
  - before a real round is submitted;
  - while it is pending;
  - after a failed request;
  - during recovery;
  - before the animation ends.
- **After a reload.** If a recovered spin's chips are no longer in memory,
  Rebet is rebuilt from the server's bets.
- **Chip animation.** Chips drop onto the table when placed and lift off
  when removed, undone, cleared or swept after a spin. There is no
  animation with reduced motion.

### Results history

- **Strip.** Above the table: the player's latest 20 settled spins, newest
  first, each in its European colour. Each entry opens its details.
- **History drawer.** An accessible dialog: Escape closes it and focus is
  trapped and restored. Each entry shows:
  - the number and colour;
  - the date and time;
  - the stake, payout and net;
  - each bet's outcome;
  - "Verify this round →", linking to the existing verifiable round page
    (`/history/<id>`).

  "Load older spins" pages back through the history.
- **Data.** Only the signed-in player's own rounds from
  `/api/rounds?game=roulette`. Nothing is generated, sampled or shared
  between players.
- **Statistics.** Red, black and zero; odd and even; low and high; and the
  most frequent numbers in the loaded sample. They are labelled *historical
  only*, with a statement that every spin is independent and past results
  predict nothing.
- **Provably fair.** The "Provably fair" panel is unchanged.

## 3. Tests

| Test | What it proves |
|---|---|
| `tests/unit/roulette-board.test.ts` | Stacking, Undo history bound, removal, 2× preserving denominations, payload = sum of chips (validated by the server schema), rebuilding Rebet from server bets, history filtering (settled roulette rounds only), statistics |
| `tests/unit/roulette-cycle.test.ts` | The cycle: opens at once with 15 s; closes at zero; one round accepted per wager; no-bet windows reopen without a round; duplicate callbacks ignored; never two phases; recovery holds until resolved; skipped wagers; hidden-tab pause and minimum resume; late timers; countdown warning only for the last 3 s with bets. Coverage: columns, dozens, colours, parity, low/high, straight, agreement with `betWins` for every pocket, combined coverage counts |
| `tests/unit/wheel-motion.test.ts` | Every pocket from any start angle lands exactly; at least five turns; monotonic motion for every start speed; the spin starts at the wheel's current speed; ball ends in the winning pocket under the pointer; speed easing without overshoot |
| `tests/unit/audio-manager.test.ts` | Profile per game; no context or sound before interaction; one-shot unlock listeners; loading only mounted profiles while sound is on; on/off and volume persist; corrupt settings ignored; effects vs ambience; cooldown and voice limits; loops start once, follow rate changes and stop on unmount; missing file, decode failure and no Web Audio are harmless |
| `tests/unit/audio-cues.test.ts` | Cue rules for Mines, Hi-Lo, Blackjack and Crash, and win, lose and push |
| `tests/unit/audio-assets.test.ts` | Every cue has a valid WAV; the size budget holds; each file equals its recipe byte for byte; a licence file is present |
| `tests/e2e/casino-experience.spec.ts` | See below |

`tests/e2e/casino-experience.spec.ts` checks, against the production build and
in real time (each window really lasts 15 s):

- **Full cycle.**
  - **Opening.** Betting is open on entry with a countdown from 15, and
    there is no Spin button.
  - **Idle.** The wheel turns with no request.
  - **Chips.** Mixed-denomination stacks; Undo of one placement.
  - **The automatic close.** It sends exactly one request with the
    aggregate amount.
  - **Landing.** The wheel stops on the server's number, checked from its
    geometry.
  - **Locking.** Betting is locked during the result.
  - **Result.** Stake and payout are shown; the table is cleared and the
    balance applied.
  - **Next windows.** The next window opens on its own. A window without
    bets sends nothing and deducts nothing.
  - **Toolbar.** Rebet, 2×, Clear with Undo, the remove tool and Delete.
  - **Second spin.** It is sent once.
  - **History.** The strip and the API agree, newest first, and are still
    correct after a refresh. The drawer shows stake, payout and net and
    links to verification.
- **Network failure.** Bets are kept and locked in `RECOVERY`, and no new
  window opens. One idempotency key is used throughout, and exactly one
  round exists after the retry. Rebet works afterwards.
- **Hidden tab.** The countdown pauses (no request after more than 15 s
  hidden) and resumes with at least 5 s. Leaving the page before the close
  sends nothing, even after the window would have ended.
- **Reduced motion.** No idle motion, and the automatic round shows its
  result at once.
- **Coverage preview.** Every column, dozen and outside bet, a straight
  number and zero highlight exactly their numbers. The preview disappears
  on leaving. Keyboard focus gives the same preview. Active chips and
  coverage dots stay visible while another position is previewed.
- **2×.** Allowed up to the whole balance, refused beyond it.
- **Touch.** The first tap previews without betting; the second places a
  chip; the remove tool works.
- **Audio.**
  - There is no `AudioContext` before an interaction, and one after it.
  - Blocked sound files do not break the automatic table or dice.
  - Mute, the effects level and the ambience switch survive a reload.
  - Sound files are served.
