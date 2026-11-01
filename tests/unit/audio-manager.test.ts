import { describe, expect, it } from 'vitest';
import { AUDIO_SETTINGS_KEY, AudioManager, DEFAULT_AUDIO_SETTINGS, sanitizeSettings, type AudioDeps, type ContextLike, type GainLike, type SourceLike } from '@/lib/audio/audio-manager';
import { cueSpec, GAME_SOUND_IDS, profileFor, SOUND_PROFILES } from '@/lib/audio/profiles';

/** A minimal stand-in for Web Audio that records what happens. */
class FakeContext implements ContextLike {
  state = 'suspended';
  currentTime = 0;
  destination = { kind: 'destination' };
  sources: (SourceLike & { started: boolean; stopped: boolean })[] = [];
  gains: GainLike[] = [];
  decoded = 0;
  closed = false;
  failDecode = false;
  createGain(): GainLike {
    const g = { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = {
      buffer: null as unknown,
      loop: false,
      playbackRate: { value: 1 },
      onended: null as (() => void) | null,
      started: false,
      stopped: false,
      connect: () => undefined,
      disconnect: () => undefined,
      start() {
        s.started = true;
      },
      stop() {
        s.stopped = true;
      },
    };
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(data: ArrayBuffer) {
    if (this.failDecode) throw new Error('decode failed');
    this.decoded += 1;
    return { decodedFrom: data.byteLength };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.closed = true;
  }
  playing() {
    return this.sources.filter((s) => s.started && !s.stopped);
  }
}

function setup(opts: { missing?: (url: string) => boolean; noAudio?: boolean; stored?: string } = {}) {
  const store = new Map<string, string>();
  if (opts.stored !== undefined) store.set(AUDIO_SETTINGS_KEY, opts.stored);
  let created = 0;
  let clock = 0;
  const fetched: string[] = [];
  const ctx = new FakeContext();
  const deps: AudioDeps = {
    createContext: () => {
      created += 1;
      return opts.noAudio ? null : ctx;
    },
    fetchAsset: async (url) => {
      fetched.push(url);
      if (opts.missing?.(url)) throw new Error('404');
      return new ArrayBuffer(64);
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => clock,
  };
  const m = new AudioManager(deps);
  return { m, ctx, store, fetched, created: () => created, tick: (ms: number) => (clock += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('sound profiles', () => {
  it('give every game its own profile with the required cues', () => {
    expect(GAME_SOUND_IDS.sort()).toEqual(['blackjack', 'crash', 'dice', 'hilo', 'keno', 'limbo', 'mines', 'plinko', 'roulette']);
    const required: Record<string, string[]> = {
      roulette: ['chip-place', 'chip-remove', 'wheel-spin', 'ball-roll', 'pocket-tick', 'win', 'lose'],
      dice: ['roll', 'land', 'result'],
      mines: ['select', 'safe', 'explosion', 'cashout'],
      crash: ['launch', 'rise', 'cashout', 'crash'],
      blackjack: ['shuffle', 'deal', 'flip', 'chip', 'win', 'lose'],
      limbo: ['launch', 'rise', 'result'],
      keno: ['draw', 'land', 'hit', 'miss'],
      plinko: ['drop', 'peg', 'slot', 'win'],
      hilo: ['reveal', 'correct', 'incorrect', 'cashout'],
    };
    for (const [game, cues] of Object.entries(required)) {
      expect(profileFor(game)).toBe(game);
      for (const cue of cues) expect(cueSpec(profileFor(game)!, cue), `${game}/${cue}`).not.toBeNull();
      // Files live in the game's own folder: profiles never share sounds.
      for (const spec of Object.values(SOUND_PROFILES[profileFor(game)!])) expect(spec.file.startsWith(`${game}/`)).toBe(true);
    }
    expect(profileFor('sports')).toBeNull();
    expect(cueSpec('dice', 'toString')).toBeNull();
  });
});

describe('audio manager', () => {
  it('creates no audio context and plays nothing before the first interaction', async () => {
    const { m, ctx, created } = setup();
    m.use('roulette');
    await flush();
    expect(m.play('roulette', 'chip-place')).toBe(false);
    m.startLoop('roulette', 'ball-roll');
    expect(created()).toBe(0);
    expect(ctx.sources).toHaveLength(0);
    expect(m.isUnlocked()).toBe(false);
  });

  it('unlocks on a gesture from attachUnlock and then plays', async () => {
    const { m, ctx } = setup();
    const listeners = new Map<string, () => void>();
    const target = { addEventListener: (t: string, fn: () => void) => void listeners.set(t, fn), removeEventListener: (t: string) => void listeners.delete(t) };
    m.attachUnlock(target as never);
    m.use('dice');
    expect([...listeners.keys()].sort()).toEqual(['keydown', 'pointerdown', 'touchstart']);
    listeners.get('pointerdown')!();
    expect(m.isUnlocked()).toBe(true);
    expect(listeners.size).toBe(0); // one-shot
    await flush();
    expect(m.play('dice', 'roll')).toBe(true);
    expect(ctx.playing()).toHaveLength(1);
  });

  it('loads only the profiles of mounted games, and only while sound is on', async () => {
    const { m, fetched } = setup({ stored: JSON.stringify({ ...DEFAULT_AUDIO_SETTINGS, enabled: false }) });
    m.use('mines');
    await flush();
    expect(fetched).toHaveLength(0);
    m.setSettings({ enabled: true });
    await flush();
    expect(fetched.sort()).toEqual(Object.values(SOUND_PROFILES.mines).map((s) => `/audio/${s.file}`).sort());
  });

  it('can be switched off and on; the choice and the volume persist', async () => {
    const first = setup();
    first.m.use('keno');
    first.m.unlock();
    await flush();
    first.m.setSettings({ enabled: false, volume: 0.25 });
    expect(first.m.play('keno', 'hit')).toBe(false);
    const saved = first.store.get(AUDIO_SETTINGS_KEY)!;
    expect(JSON.parse(saved)).toEqual({ enabled: false, effects: true, ambience: true, volume: 0.25 });

    const second = setup({ stored: saved });
    expect(second.m.getSettings()).toEqual({ enabled: false, effects: true, ambience: true, volume: 0.25 });
    second.m.use('keno');
    second.m.unlock();
    second.m.setSettings({ enabled: true });
    await flush();
    expect(second.m.play('keno', 'hit')).toBe(true);
    // Master gain follows the persisted volume.
    expect(second.ctx.gains[0]!.gain.value).toBe(0.25);
  });

  it('ignores corrupt or out-of-range stored settings', () => {
    expect(setup({ stored: '{not json' }).m.getSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(sanitizeSettings({ enabled: 'yes', volume: 7, ambience: false })).toEqual({ ...DEFAULT_AUDIO_SETTINGS, volume: 1, ambience: false });
    expect(sanitizeSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_AUDIO_SETTINGS.volume);
  });

  it('separates effects from ambience', async () => {
    const { m, ctx } = setup();
    m.use('crash');
    m.unlock();
    await flush();
    m.setSettings({ effects: false });
    expect(m.play('crash', 'launch')).toBe(false);
    m.startLoop('crash', 'rise');
    expect(ctx.playing()).toHaveLength(1); // ambience still allowed
    m.setSettings({ ambience: false });
    expect(ctx.playing()).toHaveLength(0);
    m.setSettings({ ambience: true });
    expect(ctx.playing()).toHaveLength(1); // a requested loop comes back
    expect(ctx.playing()[0]!.loop).toBe(true);
  });

  it('prevents duplicated and overlapping effects (cooldown and voice limit)', async () => {
    const { m, ctx, tick } = setup();
    m.use('roulette');
    m.unlock();
    await flush();
    expect(m.play('roulette', 'win')).toBe(true);
    expect(m.play('roulette', 'win')).toBe(false); // same instant: a doubled callback
    tick(cueSpec('roulette', 'win')!.cooldownMs + 1);
    expect(m.play('roulette', 'win')).toBe(true);
    // maxVoices 1: the earlier voice was cut.
    expect(ctx.playing().length).toBe(1);
    for (let i = 0; i < 10; i++) {
      tick(100);
      m.play('roulette', 'chip-place');
    }
    expect(ctx.playing().length).toBe(1 + cueSpec('roulette', 'chip-place')!.maxVoices);
  });

  it('starts a loop once, adjusts its rate, and stops loops and voices when the game unmounts', async () => {
    const { m, ctx } = setup();
    m.use('crash');
    m.unlock();
    await flush();
    m.startLoop('crash', 'rise');
    m.startLoop('crash', 'rise');
    expect(ctx.playing()).toHaveLength(1);
    m.setLoopRate('crash', 'rise', 1.5);
    expect(ctx.playing()[0]!.playbackRate.value).toBe(1.5);
    m.play('crash', 'cashout');
    expect(ctx.playing()).toHaveLength(2);
    m.release('crash');
    expect(ctx.playing()).toHaveLength(0);
    expect(m.debugState().assets).toHaveLength(0);
    expect(m.play('crash', 'cashout')).toBe(false);
  });

  it('keeps a profile while another screen still uses it', async () => {
    const { m } = setup();
    m.use('dice');
    m.use('dice');
    m.unlock();
    await flush();
    m.release('dice');
    expect(m.play('dice', 'roll')).toBe(true);
  });

  it('a missing file, a decode failure or no Web Audio never throws', async () => {
    const missing = setup({ missing: (u) => u.endsWith('/win.wav') });
    missing.m.use('roulette');
    missing.m.unlock();
    await flush();
    await flush();
    expect(() => missing.m.play('roulette', 'win')).not.toThrow();
    expect(missing.m.play('roulette', 'win')).toBe(false);
    expect(missing.m.play('roulette', 'lose')).toBe(true);

    const broken = setup();
    broken.ctx.failDecode = true;
    broken.m.use('dice');
    broken.m.unlock();
    await flush();
    await flush();
    expect(broken.m.play('dice', 'roll')).toBe(false);

    const none = setup({ noAudio: true });
    none.m.use('dice');
    expect(() => none.m.unlock()).not.toThrow();
    expect(none.m.isUnlocked()).toBe(false);
    expect(none.m.play('dice', 'roll')).toBe(false);
    expect(() => none.m.startLoop('crash', 'rise')).not.toThrow();

    expect(missing.m.play('roulette', 'no-such-cue')).toBe(false);
  });

  it('dispose closes the context', async () => {
    const { m, ctx } = setup();
    m.unlock();
    m.dispose();
    await flush();
    expect(ctx.closed).toBe(true);
    expect(m.isUnlocked()).toBe(false);
  });
});
