/**
 * The sound catalogue: one recipe per file named in src/lib/audio/profiles.ts.
 * Each game has its own palette of pitches and textures so it is recognisable
 * by ear. Every recipe is deterministic (fixed seeds).
 */
import { envelope, filter, finish, mix, noise, type Buf, seamless, shape, tone } from './synth';

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note → Hz

/** A struck-bell tone: sine with inharmonic partials. */
const bell = (dur: number, f: number, decay = dur / 3) => tone(dur, f, { decay, partials: [[2.01, 0.35], [3.02, 0.12], [4.2, 0.05]] });

/** A clay chip on felt: two short band-passed noise ticks and a faint body. */
function chipClick(seed: number, pitch: number, dur = 0.09): Buf {
  const a = envelope(filter(noise(dur, seed), 'bandpass', pitch, { q: 4 }), 0.0005, 0.008);
  const b = envelope(filter(noise(dur, seed + 1), 'bandpass', pitch * 0.72, { q: 5 }), 0.0005, 0.012);
  const body = tone(dur, pitch * 0.38, { decay: 0.012 });
  return finish(mix(dur, [[a, 0], [b, 0.012, 0.8], [body, 0, 0.25]]), 0.75);
}

/** Notes played one after another; each note is [midi, start s, length s]. */
function arpeggio(dur: number, notes: [number, number, number][], voice: (len: number, f: number) => Buf, peak = 0.7): Buf {
  return finish(mix(dur, notes.map(([n, at, len]) => [voice(len, NOTE(n)), at, 1] as [Buf, number, number])), peak);
}

/** Pitched swish of air: band-passed noise sweeping between two centres. */
function swish(dur: number, seed: number, from: number, to: number, q = 1.2, curve: (k: number) => number = (k) => Math.sin(Math.PI * k)): Buf {
  return shape(filter(noise(dur, seed), 'bandpass', from, { f1: to, q }), curve);
}

/** Many small clicks spread over time (dice rattle, card riffle, coins). */
function clicks(dur: number, seed: number, count: number, at: (i: number, r: () => number) => number, click: (i: number) => Buf, level: (i: number) => number = () => 1): Buf {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return mix(
    dur,
    Array.from({ length: count }, (_, i) => [click(i), at(i, r), level(i)] as [Buf, number, number]),
  );
}

/** A coin shower: bright pings at rising pitch. */
function coins(dur: number, seed: number, base: number, count = 9): Buf {
  return finish(
    clicks(
      dur,
      seed,
      count,
      (i, r) => i * (dur * 0.6) / count + r() * 0.02,
      (i) => bell(0.25, NOTE(base + [0, 4, 7, 12, 7, 12, 16, 19, 24][i % 9]!), 0.07),
      (i) => 0.9 - i * 0.05,
    ),
    0.7,
  );
}

/** A dull impact: a falling sine thump plus a burst of filtered noise. */
function thump(dur: number, seed: number, f: number, bright: number): Buf {
  const body = tone(dur, f, { f1: f * 0.55, decay: dur / 5 });
  const hit = envelope(filter(noise(dur, seed), 'lowpass', bright), 0.0008, 0.02);
  return finish(mix(dur, [[body, 0, 1], [hit, 0, 0.6]]), 0.8);
}

export const SOUNDS: Record<string, () => Buf> = {
  // ── Roulette: clay chips, a wooden wheel, an ivory ball; warm major chimes.
  'roulette/chip-place.wav': () => chipClick(11, 3200),
  'roulette/chip-remove.wav': () => finish(mix(0.1, [[chipClick(12, 4100, 0.06), 0, 0.8], [chipClick(13, 2600, 0.06), 0.035, 0.5]]), 0.6),
  'roulette/wheel-spin.wav': () => finish(mix(1.4, [[swish(1.4, 14, 300, 1400, 0.9, (k) => Math.min(1, k * 8) * Math.pow(1 - k, 1.5)), 0, 1], [envelope(filter(noise(0.08, 15), 'bandpass', 900, { q: 3 }), 0.001, 0.02), 0, 0.6]]), 0.65),
  'roulette/ball-roll.wav': () => {
    // An ivory ball on wood: a rumble with a slow periodic grain; loops seamlessly.
    const base = filter(filter(noise(2.3, 16), 'lowpass', 1800), 'highpass', 250);
    const grain = shape(base, (k) => 0.65 + 0.35 * Math.sin(2 * Math.PI * k * 2.3 * 7));
    return seamless(grain, 0.3, 0.5);
  },
  'roulette/pocket-tick.wav': () => finish(envelope(filter(noise(0.03, 17), 'bandpass', 2600, { q: 6 }), 0.0003, 0.004), 0.6, 0.001),
  // A soft wooden "tock" for each of the last seconds of betting; a two-note chime when betting closes.
  'roulette/countdown.wav': () => finish(mix(0.16, [[tone(0.16, 1046, { decay: 0.03, partials: [[2.4, 0.2]] }), 0, 1], [envelope(filter(noise(0.03, 18), 'bandpass', 1800, { q: 4 }), 0.0005, 0.005), 0, 0.5]]), 0.5),
  'roulette/no-more-bets.wav': () => arpeggio(0.8, [[76, 0, 0.45], [72, 0.16, 0.6]], (len, f) => bell(len, f, 0.2), 0.5),
  // A neutral result chime for table spins (no wager: neither a win nor a loss).
  'roulette/result.wav': () => arpeggio(0.9, [[72, 0, 0.6], [79, 0.05, 0.7]], (len, f) => bell(len, f, 0.28), 0.5),
  'roulette/wheel-ambience.wav': () => {
    // The rotor turning on its bearing: a low wooden hum with a slow rotational swell; loops seamlessly.
    const dur = 4.4;
    const hum = mix(dur, [[tone(dur, 62, { wave: 'triangle', attack: 0.001, decay: 1000 }), 0, 0.5], [tone(dur, 93.5, { attack: 0.001, decay: 1000 }), 0, 0.25]]);
    const air = filter(filter(noise(dur, 19), 'lowpass', 900), 'highpass', 120);
    return seamless(shape(mix(dur, [[hum, 0, 1], [air, 0, 0.6]]), (k) => 0.7 + 0.3 * Math.sin(2 * Math.PI * k * 4.4 * 0.5)), 0.4, 0.4);
  },
  'roulette/room.wav': () => {
    // A distant, quiet casino room: soft murmur and the odd chip clink; loops seamlessly.
    const dur = 6.4;
    const murmur = shape(filter(filter(noise(dur, 20), 'bandpass', 520, { q: 0.6 }), 'lowpass', 1400), (k) => 0.75 + 0.25 * Math.sin(2 * Math.PI * k * 3.2) * Math.sin(2 * Math.PI * k * 1.1));
    const clinks = mix(dur, [
      [chipClick(24, 3600, 0.08), 1.3, 0.25],
      [chipClick(25, 3100, 0.08), 1.42, 0.18],
      [chipClick(26, 3900, 0.08), 4.1, 0.2],
    ]);
    return seamless(mix(dur, [[murmur, 0, 1], [clinks, 0, 1]]), 0.6, 0.35);
  },
  'roulette/win.wav': () => arpeggio(1.1, [[72, 0, 0.6], [76, 0.09, 0.6], [79, 0.18, 0.6], [84, 0.27, 0.8]], (len, f) => bell(len, f, 0.25)),
  'roulette/lose.wav': () => arpeggio(0.7, [[67, 0, 0.35], [62, 0.16, 0.5]], (len, f) => tone(len, f, { wave: 'triangle', decay: 0.14 }), 0.45),

  // ── Dice: wooden cup, hard plastic dice on a table, a short confirmation.
  'dice/roll.wav': () =>
    finish(
      mix(0.55, [
        [swish(0.55, 21, 500, 900, 0.8), 0, 0.35],
        [clicks(0.55, 22, 11, (i, r) => 0.02 + i * 0.045 + r() * 0.015, (i) => envelope(filter(noise(0.03, 30 + i), 'bandpass', 1900 + (i % 3) * 400, { q: 3 }), 0.0005, 0.006)), 0, 1],
      ]),
      0.7,
    ),
  'dice/land.wav': () => thump(0.3, 23, 180, 2400),
  'dice/result.wav': () => arpeggio(0.45, [[69, 0, 0.3], [74, 0.08, 0.35]], (len, f) => tone(len, f, { wave: 'triangle', decay: 0.1 }), 0.5),
  'dice/win.wav': () => arpeggio(0.7, [[69, 0, 0.4], [73, 0.07, 0.4], [76, 0.14, 0.4], [81, 0.21, 0.5]], (len, f) => bell(len, f, 0.18)),

  // ── Mines: glassy, crystalline palette; a deep blast.
  'mines/select.wav': () => finish(mix(0.07, [[tone(0.07, 900, { f1: 1200, decay: 0.012 }), 0, 1], [envelope(filter(noise(0.04, 31), 'highpass', 3000), 0.0005, 0.004), 0, 0.3]]), 0.5),
  'mines/safe.wav': () => finish(mix(0.5, [[bell(0.5, 1318, 0.12), 0, 1], [bell(0.4, 1976, 0.08), 0.03, 0.5]]), 0.65),
  'mines/explosion.wav': () => {
    const blast = envelope(filter(noise(1.2, 32), 'lowpass', 5000, { f1: 160 }), 0.002, 0.28);
    const boom = tone(1.2, 70, { f1: 35, decay: 0.3 });
    const debris = clicks(1.2, 33, 10, (i, r) => 0.15 + r() * 0.7, (i) => envelope(filter(noise(0.03, 40 + i), 'bandpass', 1500 + i * 120, { q: 2 }), 0.0005, 0.008), () => 0.25);
    return finish(mix(1.2, [[blast, 0, 1], [boom, 0, 0.9], [debris, 0, 1]]), 0.85);
  },
  'mines/cashout.wav': () => coins(0.9, 34, 79),

  // ── Crash: engine and air; a tension drone; a metallic impact.
  'crash/launch.wav': () => finish(mix(1.0, [[swish(1.0, 41, 200, 2200, 1.4, (k) => Math.min(1, k * 4) * (1 - k * 0.6)), 0, 1], [tone(1.0, 80, { f1: 160, wave: 'saw', decay: 0.6 }), 0, 0.18]]), 0.7),
  'crash/rise.wav': () => {
    // Two detuned low saws through a lowpass with a slow pulse; loops seamlessly.
    const dur = 3.4;
    const a = tone(dur, 55, { wave: 'saw', attack: 0.001, decay: 1000 });
    const b = tone(dur, 55.9, { wave: 'saw', attack: 0.001, decay: 1000 });
    const air = filter(noise(dur, 42), 'bandpass', 700, { q: 0.8 });
    const body = filter(mix(dur, [[a, 0, 0.5], [b, 0, 0.5], [air, 0, 0.25]]), 'lowpass', 520);
    return seamless(shape(body, (k) => 0.75 + 0.25 * Math.sin(2 * Math.PI * k * 3.4 * 1.5)), 0.4, 0.45);
  },
  'crash/cashout.wav': () => finish(mix(1.0, [[coins(1.0, 43, 76, 8), 0, 1], [swish(0.4, 44, 3000, 6000, 1, (k) => 1 - k), 0, 0.2]]), 0.72),
  'crash/crash.wav': () => {
    const hit = envelope(filter(noise(1.1, 45), 'lowpass', 7000, { f1: 300 }), 0.001, 0.2);
    const metal = mix(1.1, [[tone(1.1, 210, { decay: 0.25, partials: [[2.7, 0.5], [5.4, 0.25]] }), 0, 1]]);
    const low = tone(1.1, 60, { f1: 30, decay: 0.25 });
    return finish(mix(1.1, [[hit, 0, 1], [metal, 0, 0.35], [low, 0, 0.9]]), 0.85);
  },

  // ── Blackjack: paper cards on baize, a ceramic chip, soft brass chimes.
  'blackjack/shuffle.wav': () =>
    finish(
      clicks(1.0, 51, 34, (i) => 0.05 + 0.85 * Math.pow(i / 34, 0.8), (i) => envelope(filter(noise(0.025, 60 + i), 'highpass', 2500 + (i % 5) * 300), 0.0004, 0.005), (i) => 0.5 + 0.5 * Math.sin((Math.PI * i) / 34)),
      0.55,
    ),
  'blackjack/deal.wav': () => finish(swish(0.14, 52, 5200, 2400, 0.9, (k) => Math.pow(1 - k, 2) * Math.min(1, k * 20)), 0.6),
  'blackjack/flip.wav': () => finish(mix(0.12, [[envelope(filter(noise(0.03, 53), 'bandpass', 3000, { q: 2 }), 0.0005, 0.006), 0, 1], [swish(0.1, 54, 2000, 4500, 1, (k) => 1 - k), 0.01, 0.6]]), 0.6),
  'blackjack/chip.wav': () => chipClick(55, 2700, 0.1),
  'blackjack/win.wav': () => arpeggio(1.0, [[65, 0, 0.5], [69, 0.1, 0.5], [72, 0.2, 0.7]], (len, f) => tone(len, f, { wave: 'triangle', decay: 0.25, partials: [[2, 0.2]] })),
  'blackjack/lose.wav': () => arpeggio(0.7, [[64, 0, 0.3], [60, 0.15, 0.5]], (len, f) => tone(len, f, { wave: 'sine', decay: 0.16 }), 0.45),

  // ── Limbo: synthetic, airy; a rising sweep and a bright stab.
  'limbo/launch.wav': () => finish(tone(0.45, 220, { f1: 660, wave: 'triangle', decay: 0.2 }), 0.55),
  'limbo/rise.wav': () => finish(swish(0.9, 61, 400, 3600, 1.6, (k) => Math.min(1, k * 3) * (1 - k)), 0.55),
  'limbo/result.wav': () => finish(mix(0.4, [[tone(0.4, 523, { wave: 'square', decay: 0.07 }), 0, 0.5], [tone(0.4, 784, { decay: 0.1 }), 0, 0.6]]), 0.55),
  'limbo/win.wav': () => arpeggio(0.8, [[72, 0, 0.4], [79, 0.07, 0.4], [84, 0.14, 0.6]], (len, f) => tone(len, f, { wave: 'triangle', decay: 0.18, partials: [[2, 0.3]] })),

  // ── Keno: lottery balls in a drum; marimba-like hits.
  'keno/draw.wav': () => finish(mix(0.1, [[tone(0.1, 600, { f1: 950, decay: 0.02 }), 0, 1], [envelope(filter(noise(0.05, 71), 'bandpass', 2200, { q: 2 }), 0.0005, 0.006), 0, 0.4]]), 0.5),
  'keno/land.wav': () => thump(0.12, 72, 260, 1600),
  'keno/hit.wav': () => finish(tone(0.32, NOTE(81), { decay: 0.07, partials: [[4, 0.25], [10, 0.05]] }), 0.65),
  'keno/miss.wav': () => finish(tone(0.08, 330, { wave: 'triangle', decay: 0.015 }), 0.4),

  // ── Plinko: pegs like a glockenspiel; a wooden slot.
  'plinko/drop.wav': () => finish(mix(0.25, [[tone(0.2, 880, { f1: 440, decay: 0.05 }), 0, 1], [envelope(filter(noise(0.04, 81), 'highpass', 2500), 0.0005, 0.005), 0, 0.3]]), 0.55),
  'plinko/peg.wav': () => finish(tone(0.09, NOTE(88), { decay: 0.018, partials: [[2.76, 0.3]] }), 0.5, 0.001),
  'plinko/slot.wav': () => thump(0.25, 82, 150, 1200),
  'plinko/win.wav': () => arpeggio(0.9, [[76, 0, 0.4], [80, 0.06, 0.4], [83, 0.12, 0.4], [88, 0.18, 0.6]], (len, f) => bell(len, f, 0.16)),

  // ── Hi-Lo: crisp cards; rising and falling intervals; a coin shower.
  'hilo/reveal.wav': () => finish(mix(0.15, [[swish(0.12, 91, 4200, 2000, 1, (k) => Math.pow(1 - k, 2)), 0, 0.8], [envelope(filter(noise(0.03, 92), 'bandpass', 2600, { q: 3 }), 0.0005, 0.005), 0.08, 0.7]]), 0.6),
  'hilo/correct.wav': () => arpeggio(0.5, [[74, 0, 0.3], [81, 0.08, 0.35]], (len, f) => bell(len, f, 0.12), 0.6),
  'hilo/incorrect.wav': () => finish(filter(tone(0.45, 196, { f1: 140, wave: 'saw', decay: 0.15 }), 'lowpass', 900), 0.4),
  'hilo/cashout.wav': () => coins(0.9, 93, 74),
};

/** Renders every catalogue entry. */
export function renderAll(): Map<string, Buf> {
  return new Map(Object.entries(SOUNDS).map(([file, make]) => [file, make()]));
}
