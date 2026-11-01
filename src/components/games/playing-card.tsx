'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

const RANK_TEXT = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
const SUIT_TEXT = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

/** Pip positions (card units 100×140) for 2–10, as on a printed deck. */
const PIPS: Record<number, [number, number][]> = {
  2: [[50, 32], [50, 108]],
  3: [[50, 32], [50, 70], [50, 108]],
  4: [[30, 32], [70, 32], [30, 108], [70, 108]],
  5: [[30, 32], [70, 32], [50, 70], [30, 108], [70, 108]],
  6: [[30, 32], [70, 32], [30, 70], [70, 70], [30, 108], [70, 108]],
  7: [[30, 32], [70, 32], [50, 51], [30, 70], [70, 70], [30, 108], [70, 108]],
  8: [[30, 32], [70, 32], [50, 51], [30, 70], [70, 70], [50, 89], [30, 108], [70, 108]],
  9: [[30, 32], [70, 32], [30, 57], [70, 57], [50, 70], [30, 83], [70, 83], [30, 108], [70, 108]],
  10: [[30, 32], [70, 32], [50, 45], [30, 57], [70, 57], [30, 83], [70, 83], [50, 95], [30, 108], [70, 108]],
};

const SIZE = {
  sm: 'h-14 w-10',
  md: 'h-24 w-[4.3rem] sm:h-28 sm:w-20',
  lg: 'h-36 w-[6.2rem] sm:h-44 sm:w-[7.6rem]',
} as const;

export interface PlayingCardProps {
  /** 0 = Ace … 12 = King. */
  rank?: number;
  /** 0 ♠, 1 ♥, 2 ♦, 3 ♣. */
  suit?: number;
  faceDown?: boolean;
  size?: keyof typeof SIZE;
  /** 'deal': slides in from the shoe; 'flip': turns over in place. */
  animation?: 'deal' | 'flip' | 'none';
  /** Animation delay in ms (deal order). */
  delay?: number;
  dim?: boolean;
  className?: string;
}

/**
 * A playing card drawn as SVG: paper face with corner indices, pips for
 * number cards and a framed monogram for court cards; an original Aurovane
 * back (navy lattice, gold trim). Labelled for assistive technology.
 */
export function PlayingCard({ rank = 0, suit = 0, faceDown = false, size = 'md', animation = 'deal', delay = 0, dim, className }: PlayingCardProps) {
  const uid = useId().replace(/:/g, '');
  const red = suit === 1 || suit === 2;
  const ink = red ? '#b5232a' : '#17181d';
  const r = RANK_TEXT[rank] ?? '?';
  const s = SUIT_TEXT[suit] ?? '?';
  const label = faceDown ? 'Face-down card' : `${RANK_NAMES[rank]} of ${SUIT_NAMES[suit]}`;
  const court = rank >= 10;
  const pips = PIPS[rank + 1];
  return (
    <div
      role="img"
      aria-label={label}
      title={faceDown ? undefined : `${r}${s}`}
      className={cn(
        'relative shrink-0 [perspective:600px]',
        SIZE[size],
        animation === 'deal' && 'animate-card-deal',
        animation === 'flip' && 'animate-card-flip',
        dim && 'opacity-50',
        className,
      )}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <svg viewBox="0 0 100 140" className="size-full drop-shadow-[0_6px_10px_rgba(0,0,0,0.45)]" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`paper-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fdfbf6" />
            <stop offset="1" stopColor="#ece5d6" />
          </linearGradient>
          {faceDown && (
            <pattern id={`lattice-${uid}`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M0 0 L0 10 M0 0 L10 0" stroke="#d9b25e" strokeOpacity="0.35" strokeWidth="1.2" />
            </pattern>
          )}
        </defs>
        {faceDown ? (
          <g>
            <rect x="1" y="1" width="98" height="138" rx="9" fill="#11224a" stroke="#d9cfb8" strokeWidth="1.5" />
            <rect x="7" y="7" width="86" height="126" rx="5" fill={`url(#lattice-${uid})`} stroke="#d9b25e" strokeOpacity="0.8" strokeWidth="1.2" />
            <path d="M50 52 L66 70 L50 88 L34 70 Z" fill="#11224a" stroke="#e8cf8a" strokeWidth="2" />
            <path d="M50 60 L58 70 L50 80 L42 70 Z" fill="#e8cf8a" />
          </g>
        ) : (
          <g>
            <rect x="1" y="1" width="98" height="138" rx="9" fill={`url(#paper-${uid})`} stroke="#d2c7af" strokeWidth="1.5" />
            {/* Corner indices */}
            <g fill={ink} fontFamily="Inter Variable, sans-serif" fontWeight="800">
              <text x="9" y="22" fontSize={r.length > 1 ? 17 : 20}>
                {r}
              </text>
              <text x="9" y="38" fontSize="15">
                {s}
              </text>
              <g transform="rotate(180 50 70)">
                <text x="9" y="22" fontSize={r.length > 1 ? 17 : 20}>
                  {r}
                </text>
                <text x="9" y="38" fontSize="15">
                  {s}
                </text>
              </g>
            </g>
            {rank === 0 && (
              <text x="50" y="88" fontSize="54" textAnchor="middle" fill={ink}>
                {s}
              </text>
            )}
            {pips &&
              pips.map(([x, y], i) => (
                <text key={i} x={x} y={y + 7} fontSize="20" textAnchor="middle" fill={ink} transform={y > 70 ? `rotate(180 ${x} ${y})` : undefined}>
                  {s}
                </text>
              ))}
            {court && (
              <g>
                <rect x="24" y="26" width="52" height="88" rx="4" fill={red ? '#fbe9e4' : '#ecebf3'} stroke="#c9a24f" strokeWidth="1.6" />
                <rect x="27.5" y="29.5" width="45" height="81" rx="2.5" fill="none" stroke={ink} strokeOpacity="0.35" strokeWidth="0.8" />
                <text x="50" y="76" fontSize="38" textAnchor="middle" fill={ink} fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="700">
                  {r}
                </text>
                <text x="50" y="100" fontSize="16" textAnchor="middle" fill={ink}>
                  {s}
                </text>
                <text x="50" y="47" fontSize="12" textAnchor="middle" fill="#c9a24f">
                  ♛
                </text>
              </g>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}
