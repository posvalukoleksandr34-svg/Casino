'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAudioManager } from '@/lib/audio/audio-manager';
import { IconButton } from '../ui/icon-button';
import { SlidersIcon, VolumeIcon, VolumeOffIcon } from '../ui/icons';
import { useAudioSettings } from './use-game-audio';

/**
 * Sound on/off plus a small settings panel (volume, effects, ambience).
 * Settings are stored in this browser only.
 */
export function SoundControls() {
  const [settings, update] = useAudioSettings();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const volumeId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const on = settings.enabled && settings.volume > 0;

  // The panel is portalled to <body> (the page header is its own stacking
  // context) and placed under the settings button, following scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = toggle.current?.getBoundingClientRect();
      if (r)
        setPos({
          top: r.bottom + 8,
          right: Math.max(8, window.innerWidth - r.right),
        });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrapper.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const switchSound = () => {
    // The click is a user gesture: unlock here so the first sound can play.
    getAudioManager().unlock();
    if (on) update({ enabled: false });
    else
      update({
        enabled: true,
        volume: settings.volume > 0 ? settings.volume : 0.6,
      });
  };

  return (
    <div ref={wrapper} className="relative flex items-center gap-1.5" data-testid="sound-controls">
      <IconButton
        size="sm"
        label={on ? 'Mute sound' : 'Turn sound on'}
        hint={on ? 'Sound is on' : 'Sound is off'}
        pressed={on}
        icon={on ? <VolumeIcon /> : <VolumeOffIcon />}
        onClick={switchSound}
        tooltipSide="bottom"
        tooltipAlign="start-sm-end"
        data-testid="sound-toggle"
      />
      <IconButton
        ref={toggle}
        size="sm"
        label="Sound settings"
        hint="Volume, effects and ambience"
        icon={<SlidersIcon />}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        tooltipSide="bottom"
        tooltipAlign="start-sm-end"
        data-testid="sound-settings"
      />
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="group"
            aria-label="Sound settings"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-50 w-64 max-w-[calc(100vw-16px)] space-y-3 rounded-xl border border-ink-600 bg-ink-850 p-4 text-sm shadow-[var(--shadow-card)] animate-rise"
          >
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor={volumeId} className="font-medium text-ink-100">
                  Volume
                </label>
                <span className="num text-xs text-ink-400">{Math.round(settings.volume * 100)}%</span>
              </div>
              <input
                id={volumeId}
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(settings.volume * 100)}
                onChange={(e) =>
                  update({
                    volume: Number(e.target.value) / 100,
                    enabled: true,
                  })
                }
                className="w-full accent-[var(--color-gold-500)]"
                data-testid="sound-volume"
              />
            </div>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-medium text-ink-100">Game effects</span>
                <span className="block text-xs text-ink-400">Chips, cards, results</span>
              </span>
              <input type="checkbox" checked={settings.effects} onChange={(e) => update({ effects: e.target.checked })} className="size-4 accent-[var(--color-gold-500)]" data-testid="sound-effects" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block font-medium text-ink-100">Ambience</span>
                <span className="block text-xs text-ink-400">Background loops while a round runs</span>
              </span>
              <input
                type="checkbox"
                checked={settings.ambience}
                onChange={(e) => update({ ambience: e.target.checked })}
                className="size-4 accent-[var(--color-gold-500)]"
                data-testid="sound-ambience"
              />
            </label>
            <p className="text-xs text-ink-400">Saved in this browser. Sound starts only after you interact with the page.</p>
          </div>,
          document.body,
        )}
    </div>
  );
}
