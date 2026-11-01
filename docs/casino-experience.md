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
| Volume | 60% | Master level |
| Game effects | on | One-shot cues and action loops (e.g. the rolling ball) |
| Ambience | on | Background loops (the rising tension in Crash) |

All controls have labels and tooltips and can be operated by keyboard. The
panel closes with Escape and returns focus to its button.

### Profiles

Every game has its own pitches and textures:

| Game | Cues | When they play |
|---|---|---|
| Roulette | chip place, chip remove, wheel spin, ball rolling (loop), pocket ticks, win, lose | Chip actions and toolbar; wheel start; ball on the track; each pocket the dropping ball passes; result after landing |
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

All 41 files in `public/audio/` are **original works**.

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

### Idle wheel

The wheel turns slowly (9°/s) while the page is open and while bets are
placed.

- **The idle motion is decorative.** It sends no request, moves no chips and
  shows no number.
- **A real spin.** It starts only when the server's round response arrives.
  From the current idle angle, the wheel spins at least five turns and stops
  exactly where the server's pocket is under the pointer. The ball circles
  the other way, drops into the pockets and comes to rest in the winning
  pocket.
- **After the result.** The result is held for 2.6 s. The wheel then eases
  back into idle, carrying the ball in its pocket.
- **Rendering.** Frames come from `requestAnimationFrame`, which writes
  straight to the SVG, so React does not re-render per frame.
- **Clean-up.** Unmounting cancels the frame loop and timers. A safety timer
  settles the spin if frames stop, for example in a background tab.
- **Reduced motion.** With the system setting or the account's reduced-motion
  preference there is no idle motion, and a result is shown at once.
- **Pure geometry.** The motion maths in
  `src/components/games/wheel-motion.ts` is unit-tested. A spin lands on the
  right pocket from any start angle, for all 37 pockets.

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

### Round flow and automatic clearing

The flow is idle → requesting → spinning → revealed.

- **While a request is pending or the wheel is spinning:**
  - the table is locked;
  - nothing is cleared;
  - the Spin button cannot be pressed twice. A ref guards against a double
    click before React re-renders, and the button is disabled.
- **When the wheel lands** (the wheel reports each round id once; the screen
  also ignores repeats):
  1. the deferred balance is applied;
  2. the result and payout are shown;
  3. the combination is kept for Rebet;
  4. the chips, the total and the positions are cleared.

  Winning and losing spins are cleared alike, and new bets can be placed at
  once.
- **A failed request clears nothing.** If the network drops, `useRound`
  keeps its pending record with the same idempotency key. The table stays
  locked until the player chooses "Retry safely", which returns the original
  result or performs it exactly once, or "Discard". A new wager cannot be
  started meanwhile.
- **After a reload.** If a recovered spin's chips are no longer in memory,
  Rebet is rebuilt from the server's bets.

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
| `tests/unit/wheel-motion.test.ts` | Every pocket from any start angle lands exactly; at least five turns; monotonic motion; ball ends in the winning pocket under the pointer; idle ramp |
| `tests/unit/audio-manager.test.ts` | Profile per game; no context or sound before interaction; one-shot unlock listeners; loading only mounted profiles while sound is on; on/off and volume persist; corrupt settings ignored; effects vs ambience; cooldown and voice limits; loops start once, follow rate changes and stop on unmount; missing file, decode failure and no Web Audio are harmless |
| `tests/unit/audio-cues.test.ts` | Cue rules for Mines, Hi-Lo, Blackjack and Crash, and win, lose and push |
| `tests/unit/audio-assets.test.ts` | Every cue has a valid WAV; the size budget holds; each file equals its recipe byte for byte; a licence file is present |
| `tests/e2e/casino-experience.spec.ts` | See below |

`tests/e2e/casino-experience.spec.ts` checks, against the production build:

- **Idle wheel.** It turns on load with no wager request and no balance
  change.
- **Chips.** Mixed-denomination stacks and their totals; Undo.
- **Spin.** A double-clicked Spin sends exactly one request, whose payload is
  the aggregate from the chips.
- **Landing.** The wheel lands on the server's number, checked from its final
  rotation.
- **Clearing.** The table is cleared only after landing, and the balance is
  then applied.
- **Toolbar.** Rebet, 2×, Clear with Undo, remove mode, and Delete.
- **History.** The strip and the API agree, newest first; the drawer and its
  verification link work.
- **Network failure.** Every bet is kept, one idempotency key is used
  throughout, and exactly one round is created after the retry.
- **Reduced motion.**
- **Audio.** No `AudioContext` before interaction; one after it. Blocked
  sound files do not break roulette or dice. Mute and ambience settings
  survive a reload. Sound files are served.
