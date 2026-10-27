import { useId } from 'react';
import { avatarPreset } from '@/lib/avatars';
import { cn } from '@/lib/cn';

const SHAPES: Record<string, string> = {
  diamond: 'M20 7l11 13-11 13L9 20z',
  circle: 'M20 9a11 11 0 1 1 0 22a11 11 0 1 1 0-22z',
  triangle: 'M20 8l12 22H8z',
  square: 'M10 10h20v20H10z',
  star: 'M20 7l3.6 8.1 8.8.9-6.6 5.9 1.9 8.6L20 26.1l-7.7 4.4 1.9-8.6-6.6-5.9 8.8-.9z',
  wave: 'M7 23c4-6 8-6 13 0s9 6 13 0v7H7z',
  hexagon: 'M20 7l11 6.5v13L20 33 9 26.5v-13z',
  moon: 'M24 8a12 12 0 1 0 8 19A10 10 0 1 1 24 8z',
};

/** A preset avatar, or the name's initials when none is chosen. Purely decorative next to a visible name. */
export function Avatar({ avatar, name, className }: { avatar: string | null | undefined; name: string; className?: string }) {
  const gid = useId().replace(/:/g, '');
  const preset = avatarPreset(avatar);
  if (!preset) {
    return (
      <span aria-hidden="true" className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-gold-400 to-gold-600 text-sm font-semibold text-ink-950', className)}>
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn('size-10 shrink-0 rounded-xl bg-ink-800', className)}>
      <defs>
        <linearGradient id={`av-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={preset.from} />
          <stop offset="1" stopColor={preset.to} />
        </linearGradient>
      </defs>
      <path d={SHAPES[preset.shape]} fill={`url(#av-${gid})`} />
    </svg>
  );
}
