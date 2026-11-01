/**
 * The shared, client-side audio manager used by every game.
 *
 * - **No autoplay.** No AudioContext exists, and nothing can sound, until
 *   `unlock()` runs from the first pointer, touch or key interaction.
 * - **Lazy assets.** Only the profiles of mounted games are fetched, and only
 *   while sound is on; buffers are dropped when a game unmounts.
 * - **Bounded playback.** Each cue has a cooldown and a voice limit, so a burst
 *   of identical events (or a callback firing twice) cannot stack up.
 * - **Never in the way.** Every public method catches its own failures: a
 *   missing file, a decode error or a browser without Web Audio means silence,
 *   never a broken game.
 *
 * Audio is presentation only and never influences a round.
 */
import { AUDIO_BASE, cueSpec, SOUND_PROFILES, type CueSpec, type GameSoundId } from './profiles';

export interface AudioSettings {
  /** Master switch. */
  enabled: boolean;
  /** Game effects (chips, cards, results). */
  effects: boolean;
  /** Background ambience loops (e.g. the rising tension in Crash). */
  ambience: boolean;
  /** Master volume, 0–1. */
  volume: number;
  /** Level of game effects relative to the master volume, 0–1. */
  effectsVolume: number;
  /** Level of ambience loops relative to the master volume, 0–1. */
  ambienceVolume: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = Object.freeze({ enabled: true, effects: true, ambience: true, volume: 0.6, effectsVolume: 1, ambienceVolume: 0.7 });
export const AUDIO_SETTINGS_KEY = 'aurovane:audio:v1';

// ── The small part of Web Audio the manager uses (so tests can supply fakes).
export interface ParamLike {
  value: number;
}
export interface NodeLike {
  connect(target: unknown): unknown;
  disconnect(): void;
}
export interface GainLike extends NodeLike {
  gain: ParamLike;
}
export interface SourceLike extends NodeLike {
  buffer: unknown;
  loop: boolean;
  playbackRate: ParamLike;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface ContextLike {
  state: string;
  currentTime: number;
  destination: unknown;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  resume(): Promise<void>;
  suspend?(): Promise<void>;
  close?(): Promise<void>;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface AudioDeps {
  createContext: () => ContextLike | null;
  fetchAsset: (url: string) => Promise<ArrayBuffer>;
  storage: StorageLike | null;
  now: () => number;
}

interface Asset {
  data: Promise<ArrayBuffer | null> | null;
  buffer: unknown;
  decoding: Promise<void> | null;
  failed: boolean;
}

interface Voice {
  source: SourceLike;
  gain: GainLike;
  startedAt: number;
}

interface Loop {
  profile: GameSoundId;
  cue: string;
  rate: number;
  voice: Voice | null;
}

export function sanitizeSettings(raw: unknown): AudioSettings {
  const s = { ...DEFAULT_AUDIO_SETTINGS };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.enabled === 'boolean') s.enabled = r.enabled;
    if (typeof r.effects === 'boolean') s.effects = r.effects;
    if (typeof r.ambience === 'boolean') s.ambience = r.ambience;
    for (const k of ['volume', 'effectsVolume', 'ambienceVolume'] as const) {
      const v = r[k];
      if (typeof v === 'number' && Number.isFinite(v)) s[k] = Math.min(1, Math.max(0, v));
    }
  }
  return s;
}

const key = (profile: GameSoundId, cue: string) => `${profile}:${cue}`;

export class AudioManager {
  private settings: AudioSettings;
  private readonly listeners = new Set<() => void>();
  private ctx: ContextLike | null = null;
  private master: GainLike | null = null;
  private effectsBus: GainLike | null = null;
  private ambienceBus: GainLike | null = null;
  private unlocked = false;
  private readonly inUse = new Map<GameSoundId, number>();
  private readonly assets = new Map<string, Asset>();
  private readonly voices = new Map<string, Voice[]>();
  private readonly lastStart = new Map<string, number>();
  private readonly loops = new Map<string, Loop>();
  /** The most recent internal failure, for diagnostics; never thrown. */
  lastError: unknown = null;

  constructor(private readonly deps: AudioDeps) {
    this.settings = this.load();
  }

  // ── Settings ────────────────────────────────────────────────────────────

  getSettings = (): AudioSettings => this.settings;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setSettings(patch: Partial<AudioSettings>): void {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    this.guard(() => this.deps.storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(this.settings)));
    this.guard(() => {
      this.applyLevels();
      if (this.settings.enabled) for (const profile of this.inUse.keys()) this.preload(profile);
      if (!this.settings.enabled || !this.settings.effects) this.stopEffects();
      this.syncLoops();
    });
    for (const l of this.listeners) this.guard(l);
  }

  private load(): AudioSettings {
    try {
      const raw = this.deps.storage?.getItem(AUDIO_SETTINGS_KEY);
      return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_AUDIO_SETTINGS };
    } catch (err) {
      this.lastError = err;
      return { ...DEFAULT_AUDIO_SETTINGS };
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Creates the audio context. Call only from a user gesture. */
  unlock(): void {
    if (this.unlocked) return;
    this.guard(() => {
      const ctx = this.deps.createContext();
      if (!ctx) return;
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.effectsBus = ctx.createGain();
      this.ambienceBus = ctx.createGain();
      this.effectsBus.connect(this.master);
      this.ambienceBus.connect(this.master);
      this.master.connect(ctx.destination);
      this.unlocked = true;
      this.applyLevels();
      void ctx.resume().catch((err) => (this.lastError = err));
      for (const profile of this.inUse.keys()) this.decodeProfile(profile);
      this.syncLoops();
    });
  }

  /**
   * Installs one-shot listeners that unlock audio on the first interaction,
   * and pauses the context while the page is hidden. Returns a detach function.
   */
  attachUnlock(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>): () => void {
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const onGesture = () => {
      this.unlock();
      if (this.unlocked) for (const e of events) target.removeEventListener(e, onGesture, true);
    };
    const onVisibility = () =>
      this.guard(() => {
        if (!this.ctx) return;
        if (doc?.visibilityState === 'hidden') void this.ctx.suspend?.().catch(() => undefined);
        else void this.ctx.resume().catch(() => undefined);
      });
    if (!this.unlocked) for (const e of events) target.addEventListener(e, onGesture, { capture: true, passive: true });
    doc?.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const e of events) target.removeEventListener(e, onGesture, true);
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  }

  /** A game screen mounted: make its profile available. */
  use(profile: GameSoundId): void {
    this.guard(() => {
      this.inUse.set(profile, (this.inUse.get(profile) ?? 0) + 1);
      if (this.settings.enabled) this.preload(profile);
    });
  }

  /** A game screen unmounted: stop its sounds and free its buffers. */
  release(profile: GameSoundId): void {
    this.guard(() => {
      const n = (this.inUse.get(profile) ?? 0) - 1;
      if (n > 0) {
        this.inUse.set(profile, n);
        return;
      }
      this.inUse.delete(profile);
      for (const cue of Object.keys(SOUND_PROFILES[profile])) {
        this.stopLoop(profile, cue);
        this.stopVoices(key(profile, cue));
        this.lastStart.delete(key(profile, cue));
      }
      for (const spec of Object.values(SOUND_PROFILES[profile]) as CueSpec[]) this.assets.delete(spec.file);
    });
  }

  /** Stops everything that is sounding. */
  stopAll(): void {
    this.guard(() => {
      for (const k of [...this.loops.keys()]) {
        const l = this.loops.get(k)!;
        this.stopLoop(l.profile, l.cue);
      }
      for (const k of [...this.voices.keys()]) this.stopVoices(k);
    });
  }

  // ── Playback ────────────────────────────────────────────────────────────

  /**
   * Plays a one-shot cue. Returns whether it started (false before the first
   * interaction, when muted, during the cue's cooldown, or if its file is
   * missing).
   */
  play(profile: GameSoundId, cue: string, opts: { rate?: number; gain?: number } = {}): boolean {
    try {
      const spec = cueSpec(profile, cue);
      if (!spec || spec.kind !== 'effect') return false;
      if (!this.unlocked || !this.ctx || !this.settings.enabled || !this.settings.effects || this.settings.volume <= 0 || this.settings.effectsVolume <= 0) return false;
      const k = key(profile, cue);
      const now = this.deps.now();
      const last = this.lastStart.get(k);
      if (last !== undefined && now - last < spec.cooldownMs) return false;
      const buffer = this.bufferFor(profile, spec);
      if (!buffer) return false;
      const voices = this.prune(k);
      while (voices.length >= spec.maxVoices) this.stopVoice(voices.shift()!);
      const voice = this.start(buffer, this.effectsBus!, spec.gain * (opts.gain ?? 1), opts.rate ?? 1, false);
      voice.source.onended = () => this.guard(() => this.forget(k, voice));
      voices.push(voice);
      this.voices.set(k, voices);
      this.lastStart.set(k, now);
      return true;
    } catch (err) {
      this.lastError = err;
      return false;
    }
  }

  /** Requests a loop; it sounds whenever its switch allows (now or later) until stopped. */
  startLoop(profile: GameSoundId, cue: string, opts: { rate?: number } = {}): void {
    this.guard(() => {
      const spec = cueSpec(profile, cue);
      if (!spec || spec.kind !== 'loop') return;
      const k = key(profile, cue);
      const existing = this.loops.get(k);
      if (existing) {
        this.setLoopRate(profile, cue, opts.rate ?? existing.rate);
        return;
      }
      this.loops.set(k, { profile, cue, rate: opts.rate ?? 1, voice: null });
      this.syncLoops();
    });
  }

  setLoopRate(profile: GameSoundId, cue: string, rate: number): void {
    this.guard(() => {
      const l = this.loops.get(key(profile, cue));
      if (!l) return;
      l.rate = Math.min(4, Math.max(0.25, rate));
      if (l.voice) l.voice.source.playbackRate.value = l.rate;
    });
  }

  stopLoop(profile: GameSoundId, cue: string): void {
    this.guard(() => {
      const k = key(profile, cue);
      const l = this.loops.get(k);
      if (!l) return;
      if (l.voice) this.stopVoice(l.voice);
      this.loops.delete(k);
    });
  }

  /** For tests and diagnostics: what is sounding right now. */
  debugState() {
    return {
      unlocked: this.unlocked,
      profiles: [...this.inUse.keys()],
      assets: [...this.assets.keys()],
      voices: [...this.voices.entries()].map(([k, v]) => [k, v.length] as const).filter(([, n]) => n > 0),
      loops: [...this.loops.values()].map((l) => ({ cue: key(l.profile, l.cue), sounding: l.voice !== null, rate: l.rate })),
    };
  }

  /** Releases the audio context (tests, or a full teardown). */
  dispose(): void {
    this.stopAll();
    this.guard(() => void this.ctx?.close?.().catch(() => undefined));
    this.ctx = null;
    this.unlocked = false;
    this.assets.clear();
    this.inUse.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.lastError = err;
    }
  }

  private applyLevels(): void {
    const s = this.settings;
    if (this.master) this.master.gain.value = s.enabled ? s.volume : 0;
    if (this.effectsBus) this.effectsBus.gain.value = s.effects ? s.effectsVolume : 0;
    if (this.ambienceBus) this.ambienceBus.gain.value = s.ambience ? s.ambienceVolume : 0;
  }

  private asset(file: string): Asset {
    let a = this.assets.get(file);
    if (!a) {
      a = { data: null, buffer: null, decoding: null, failed: false };
      this.assets.set(file, a);
    }
    return a;
  }

  /** Fetches (network only, no audio) the files of a profile. */
  private preload(profile: GameSoundId): void {
    for (const spec of Object.values(SOUND_PROFILES[profile]) as CueSpec[]) {
      const a = this.asset(spec.file);
      if (a.data || a.failed) continue;
      a.data = this.deps.fetchAsset(AUDIO_BASE + spec.file).then(
        (d) => d,
        (err) => {
          this.lastError = err;
          a.failed = true;
          return null;
        },
      );
    }
    if (this.unlocked) this.decodeProfile(profile);
  }

  private decodeProfile(profile: GameSoundId): void {
    for (const spec of Object.values(SOUND_PROFILES[profile]) as CueSpec[]) this.decode(spec.file);
  }

  private decode(file: string): void {
    const a = this.assets.get(file);
    if (!a || !a.data || a.buffer || a.decoding || a.failed || !this.ctx) return;
    const ctx = this.ctx;
    a.decoding = a.data
      .then(async (data) => {
        if (!data) return;
        const buffer = await ctx.decodeAudioData(data);
        // Ignore the result if the game was left (asset dropped) meanwhile.
        if (this.assets.get(file) === a) a.buffer = buffer;
      })
      .catch((err) => {
        this.lastError = err;
        a.failed = true;
      })
      .finally(() => {
        a.decoding = null;
        this.guard(() => this.syncLoops());
      });
  }

  private bufferFor(profile: GameSoundId, spec: CueSpec): unknown {
    if (!this.inUse.has(profile)) return null;
    const a = this.assets.get(spec.file);
    if (!a) {
      this.preload(profile);
      return null;
    }
    if (!a.buffer) this.decode(spec.file);
    return a.buffer;
  }

  private start(buffer: unknown, bus: GainLike, level: number, rate: number, loop: boolean): Voice {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(bus);
    source.start();
    return { source, gain, startedAt: this.deps.now() };
  }

  private stopVoice(v: Voice): void {
    this.guard(() => {
      v.source.onended = null;
      v.source.stop();
    });
    this.guard(() => v.source.disconnect());
    this.guard(() => v.gain.disconnect());
  }

  private prune(k: string): Voice[] {
    return this.voices.get(k) ?? [];
  }

  private forget(k: string, voice: Voice): void {
    const list = this.voices.get(k);
    if (!list) return;
    const i = list.indexOf(voice);
    if (i >= 0) list.splice(i, 1);
    this.guard(() => voice.source.disconnect());
    this.guard(() => voice.gain.disconnect());
  }

  private stopVoices(k: string): void {
    for (const v of this.voices.get(k) ?? []) this.stopVoice(v);
    this.voices.delete(k);
  }

  private stopEffects(): void {
    for (const k of [...this.voices.keys()]) this.stopVoices(k);
  }

  /** Starts requested loops that can sound, and stops those that may not. */
  private syncLoops(): void {
    const audible = this.unlocked && this.settings.enabled && this.settings.volume > 0;
    for (const l of this.loops.values()) {
      const spec = cueSpec(l.profile, l.cue);
      const allowed = audible && spec !== null && (spec.bus === 'ambience' ? this.settings.ambience && this.settings.ambienceVolume > 0 : this.settings.effects && this.settings.effectsVolume > 0);
      if (!allowed) {
        if (l.voice) this.stopVoice(l.voice);
        l.voice = null;
        continue;
      }
      if (l.voice) continue;
      const buffer = this.bufferFor(l.profile, spec);
      if (buffer) l.voice = this.start(buffer, spec.bus === 'ambience' ? this.ambienceBus! : this.effectsBus!, spec.gain, l.rate, true);
    }
  }
}

function browserDeps(): AudioDeps {
  const hasWindow = typeof window !== 'undefined';
  return {
    createContext: () => {
      if (!hasWindow) return null;
      const w = window as unknown as { AudioContext?: new () => ContextLike; webkitAudioContext?: new () => ContextLike };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      return Ctor ? new Ctor() : null;
    },
    fetchAsset: async (url) => {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`audio asset ${url}: HTTP ${res.status}`);
      return res.arrayBuffer();
    },
    storage: (() => {
      try {
        return hasWindow ? window.localStorage : null;
      } catch {
        return null;
      }
    })(),
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  };
}

let singleton: AudioManager | null = null;

/** The page's shared manager (created on first use in the browser). */
export function getAudioManager(): AudioManager {
  if (!singleton) singleton = new AudioManager(browserDeps());
  return singleton;
}
