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
                  Master volume
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
            <ChannelControl
              label="Game effects"
              detail="Chips, cards, wheel, results"
              on={settings.effects}
              level={settings.effectsVolume}
              onToggle={(v) => update({ effects: v })}
              onLevel={(v) => update({ effectsVolume: v, effects: true })}
              testId="sound-effects"
            />
            <ChannelControl
              label="Ambience"
              detail="Background loops while a round runs"
              on={settings.ambience}
              level={settings.ambienceVolume}
              onToggle={(v) => update({ ambience: v })}
              onLevel={(v) => update({ ambienceVolume: v, ambience: true })}
              testId="sound-ambience"
            />
            <p className="text-xs text-ink-400">Saved in this browser. Sound starts only after you interact with the page.</p>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** One sound channel: an on/off switch and its own level. */
function ChannelControl({ label, detail, on, level, onToggle, onLevel, testId }: { label: string; detail: string; on: boolean; level: number; onToggle: (on: boolean) => void; onLevel: (level: number) => void; testId: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5 border-t border-ink-700 pt-3">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block font-medium text-ink-100">{label}</span>
          <span className="block text-xs text-ink-400">{detail}</span>
        </span>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} className="size-4 accent-[var(--color-gold-500)]" data-testid={testId} />
      </label>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {label} volume
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(level * 100)}
          disabled={!on}
          onChange={(e) => onLevel(Number(e.target.value) / 100)}
          className="w-full accent-[var(--color-gold-500)] disabled:opacity-50"
          data-testid={`${testId}-volume`}
        />
        <span className="num w-9 text-right text-xs text-ink-400" aria-hidden="true">
          {Math.round(level * 100)}%
        </span>
      </div>
    </div>
  );
}
