/**
 * A tiny deterministic synthesiser for Aurovane's sound effects. Every sound
 * is computed from oscillators, seeded noise and filters, so the files are
 * original works and the same source always yields byte-identical WAVs.
 */

export const SAMPLE_RATE = 22_050;

export type Buf = Float32Array;

export const seconds = (s: number) => Math.max(1, Math.round(s * SAMPLE_RATE));
export const silence = (s: number): Buf => new Float32Array(seconds(s));

/** mulberry32: a small seeded PRNG, so noise is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noise(dur: number, seed: number): Buf {
  const r = rng(seed);
  const out = silence(dur);
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
  return out;
}

export type Wave = 'sine' | 'triangle' | 'saw' | 'square';

function osc(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine':
      return Math.sin(2 * Math.PI * p);
    case 'triangle':
      return 1 - 4 * Math.abs(p - 0.5);
    case 'saw':
      return 2 * p - 1;
    case 'square':
      return p < 0.5 ? 0.8 : -0.8;
  }
}

/**
 * A tone whose frequency glides from `f0` to `f1` (exponentially) with an
 * attack and an exponential decay. Partials add harmonics at given levels.
 */
export function tone(
  dur: number,
  f0: number,
  opts: { f1?: number; wave?: Wave; attack?: number; decay?: number; partials?: [number, number][]; vibrato?: [number, number] } = {},
): Buf {
  const { f1 = f0, wave = 'sine', attack = 0.004, decay = dur / 4, partials = [], vibrato } = opts;
  const out = silence(dur);
  let phase = 0;
  const phases = partials.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const k = out.length > 1 ? i / (out.length - 1) : 0;
    let f = f0 * Math.pow(f1 / f0, k);
    if (vibrato) f *= 1 + vibrato[1] * Math.sin(2 * Math.PI * vibrato[0] * t);
    phase += f / SAMPLE_RATE;
    let v = osc(wave, phase);
    partials.forEach(([mult, level], j) => {
      phases[j]! += (f * mult) / SAMPLE_RATE;
      v += level * Math.sin(2 * Math.PI * phases[j]!);
    });
    const env = Math.min(1, t / attack) * Math.exp(-t / decay);
    out[i] = v * env;
  }
  return out;
}

/** RBJ biquad filter; the cutoff may change over the sound (start → end, exponential). */
export function filter(input: Buf, type: 'lowpass' | 'highpass' | 'bandpass', f0: number, opts: { f1?: number; q?: number } = {}): Buf {
  const { f1 = f0, q = 0.707 } = opts;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const k = input.length > 1 ? i / (input.length - 1) : 0;
    const fc = Math.min(SAMPLE_RATE * 0.45, f0 * Math.pow(f1 / f0, k));
    const w = (2 * Math.PI * fc) / SAMPLE_RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    const x = input[i]!;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Multiplies by an attack / exponential-decay envelope. */
export function envelope(input: Buf, attack: number, decay: number, hold = 0): Buf {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const t = i / SAMPLE_RATE;
    const a = attack > 0 ? Math.min(1, t / attack) : 1;
    const d = t < hold ? 1 : Math.exp(-(t - hold) / decay);
    out[i] = input[i]! * a * d;
  }
  return out;
}

/** Applies an arbitrary gain curve g(t in 0..1). */
export function shape(input: Buf, g: (k: number) => number): Buf {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i]! * g(input.length > 1 ? i / (input.length - 1) : 0);
  return out;
}

export function gain(input: Buf, g: number): Buf {
  return input.map((v) => v * g);
}

/** Mixes parts into a buffer of `dur` seconds: each part is [buffer, offset seconds, gain]. */
export function mix(dur: number, parts: [Buf, number, number?][]): Buf {
  const out = silence(dur);
  for (const [buf, at, g = 1] of parts) {
    const start = Math.round(at * SAMPLE_RATE);
    for (let i = 0; i < buf.length && start + i < out.length; i++) out[start + i]! += buf[i]! * g;
  }
  return out;
}

/** Peak-normalises to `peak` and applies short fades so nothing clicks. */
export function finish(input: Buf, peak = 0.7, fade = 0.004): Buf {
  let max = 0;
  for (const v of input) max = Math.max(max, Math.abs(v));
  const out = max > 0 ? input.map((v) => (v / max) * peak) : input.slice();
  const n = Math.min(seconds(fade), Math.floor(out.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    out[i]! *= g;
    out[out.length - 1 - i]! *= g;
  }
  return out;
}

/**
 * Makes a buffer loop seamlessly: the last `xfade` seconds are blended into
 * the start, and the result is that much shorter.
 */
export function seamless(input: Buf, xfade: number, peak = 0.6): Buf {
  const n = seconds(xfade);
  const len = input.length - n;
  const out = input.slice(0, len);
  for (let i = 0; i < n; i++) {
    const g = i / n;
    out[i] = input[i]! * g + input[len + i]! * (1 - g);
  }
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  return max > 0 ? out.map((v) => (v / max) * peak) : out;
}

/** 16-bit PCM mono WAV. */
export function wav(samples: Buf): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    data.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
