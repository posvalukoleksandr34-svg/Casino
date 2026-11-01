'use client';

import { formatChips } from '@/engine/money';
import { cn } from '@/lib/cn';
import { breakdown, CHIP_DENOMINATIONS, chipColor, type ChipColor } from './roulette-board';

/** Physical chip colours: body, edge inserts, centre inlay and label ink. */
const CHIP_STYLE: Record<ChipColor, { body: string; edge: string; inlay: string; ink: string }> = {
  white: { body: '#ece8df', edge: '#2f6fae', inlay: '#f8f6f1', ink: '#1a1b20' },
  red: { body: '#b52b25', edge: '#f4efe6', inlay: '#d24a43', ink: '#ffffff' },
  green: { body: '#1d7a49', edge: '#f4efe6', inlay: '#2a9460', ink: '#ffffff' },
  black: { body: '#16171b', edge: '#d9bb76', inlay: '#2a2c33', ink: '#f3e6c2' },
  purple: { body: '#5b2a86', edge: '#f4efe6', inlay: '#7440a3', ink: '#ffffff' },
  orange: { body: '#df7a1c', edge: '#2a1a0c', inlay: '#f09a45', ink: '#1a1208' },
};

export function chipLabel(minor: number): string {
  return CHIP_DENOMINATIONS.find((d) => d.value === minor)?.label ?? shortChips(minor);
}

/** A compact total for a chip face: "31", "125", "2.5", "1.6k", "10k". */
export function compactChips(minor: number): string {
  const chips = minor / 100;
  if (chips >= 1000) return `${(Math.floor(chips / 100) / 10).toFixed(chips >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return Number.isInteger(chips) ? String(chips) : String(Math.round(chips * 10) / 10);
}

/** A chip amount without trailing zero decimals ("30", "12.50"). */
export function shortChips(minor: number): string {
  return formatChips(minor).replace(/\.00$/, '');
}

/** A casino chip face. Decorative: callers provide the accessible name. */
export function ChipFace({ value, className, label = true, text: override }: { value: number; className?: string; label?: boolean; text?: string }) {
  const s = CHIP_STYLE[chipColor(value)];
  const text = override ?? chipLabel(value);
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="19" fill={s.body} stroke="rgb(0 0 0 / 0.45)" strokeWidth="1" />
      {/* Edge inserts */}
      <circle cx="20" cy="20" r="16.5" fill="none" stroke={s.edge} strokeWidth="5" strokeDasharray="6.48 6.48" />
      <circle cx="20" cy="20" r="12.2" fill={s.inlay} stroke={s.edge} strokeOpacity="0.7" strokeWidth="0.8" strokeDasharray="1.6 1.6" />
      <ellipse cx="15" cy="12" rx="9" ry="5" fill="#ffffff" opacity="0.16" />
      {label && (
        <text x="20" y="20.6" textAnchor="middle" dominantBaseline="central" fontSize={text.length >= 4 ? 8.5 : text.length === 3 ? 9.5 : 11.5} fontWeight="800" fill={s.ink} fontFamily="Inter Variable, sans-serif">
          {text}
        </text>
      )}
    </svg>
  );
}

const MAX_VISIBLE = 6;

/**
 * Chips stacked on a betting position, as on a real layout: placement order,
 * newest on top, each in its denomination's colour. The top chip shows the
 * position's total. Decorative; the position button carries the label.
 */
export function ChipStack({ chips, total, className, animate = true }: { chips: readonly number[]; total: number; className?: string; animate?: boolean }) {
  const shown = chips.slice(-MAX_VISIBLE);
  const first = chips.length - shown.length;
  const lift = 2.5;
  return (
    <span className={cn('pointer-events-none absolute z-10 block size-[28px]', className)} style={{ marginTop: ((shown.length - 1) * lift) / 2 }} aria-hidden="true" data-chip-stack={chips.join(',')}>
      {shown.map((v, i) => (
        // Keyed by the chip's place in the whole stack: only a newly placed chip mounts (and drops in).
        <span key={first + i} className="absolute inset-0" style={{ transform: `translateY(${-(i * lift)}px)` }}>
          <span className={cn('block size-full rounded-full shadow-[0_1.5px_0_rgb(0_0_0/0.6)]', animate && 'animate-chip-drop')}>
            <ChipFace value={v} className="size-full" label={i === shown.length - 1} text={compactChips(total)} />
          </span>
        </span>
      ))}
    </span>
  );
}

/** A chip leaving a position (removed, undone, cleared or swept after a spin). */
export function ChipGhost({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('pointer-events-none absolute z-10 block size-[28px] animate-chip-lift', className)} aria-hidden="true">
      <ChipFace value={value} className="size-full" label={false} />
    </span>
  );
}

/** "1×25, 1×5" — a position's chips by denomination, for labels. */
export function describeChips(chips: readonly number[]): string {
  return breakdown(chips)
    .map((b) => `${b.count}×${chipLabel(b.value)}`)
    .join(', ');
}
