'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { DEFAULT_AUDIO_SETTINGS, getAudioManager, type AudioSettings } from '@/lib/audio/audio-manager';
import type { CueOf, GameSoundId } from '@/lib/audio/profiles';

/**
 * Connects a game screen to the shared audio manager: its profile is loaded
 * while the screen is mounted, and its sounds stop and its buffers are
 * released when the player leaves. Audio unlocks on the first interaction.
 */
export function useGameAudio<G extends GameSoundId>(profile: G) {
  useEffect(() => {
    const m = getAudioManager();
    m.use(profile);
    const detach = m.attachUnlock(window, document);
    return () => {
      detach();
      m.release(profile);
    };
  }, [profile]);

  return useMemo(
    () => ({
      play: (cue: CueOf<G>, opts?: { rate?: number; gain?: number }) => getAudioManager().play(profile, cue, opts),
      startLoop: (cue: CueOf<G>, opts?: { rate?: number }) => getAudioManager().startLoop(profile, cue, opts),
      setLoopRate: (cue: CueOf<G>, rate: number) => getAudioManager().setLoopRate(profile, cue, rate),
      stopLoop: (cue: CueOf<G>) => getAudioManager().stopLoop(profile, cue),
    }),
    [profile],
  );
}

export type GameAudio<G extends GameSoundId> = ReturnType<typeof useGameAudio<G>>;

const serverSettings = () => DEFAULT_AUDIO_SETTINGS;

/** The persisted sound settings, kept in sync across components. */
export function useAudioSettings(): [AudioSettings, (patch: Partial<AudioSettings>) => void] {
  const m = getAudioManager();
  const settings = useSyncExternalStore(m.subscribe, m.getSettings, serverSettings);
  return [settings, (patch) => m.setSettings(patch)];
}

/**
 * Plays the cues `derive` finds between consecutive server views of a round.
 * The first round a screen sees is sounded only if the player asked for it
 * (`arm()` before starting): restoring an open round after a reload stays
 * silent, while later changes (including a crash found by polling) sound.
 */
export function useRoundCues<R, C extends string>(round: R | null, derive: (prev: R | null, next: R | null) => C[], play: (cue: C) => unknown) {
  const prev = useRef<R | null>(round);
  const armed = useRef(false);
  useEffect(() => {
    if (round === prev.current) return;
    if (prev.current !== null || armed.current) for (const cue of derive(prev.current, round)) play(cue);
    armed.current = false;
    prev.current = round;
    // derive/play are stable module functions or memoised callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  return useCallback(() => {
    armed.current = true;
  }, []);
}
