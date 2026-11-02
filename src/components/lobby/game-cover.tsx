/**
 * Original cover art for each game: a small scene in the game's own colour
 * world, drawn as inline SVG (no image files, no third-party assets). Purely
 * decorative — tiles carry the game's name as text.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { symbolGraphic, type SlotTheme } from '../games/slots/symbol-art';

interface Theme {
  /** Background gradient stops (top-left → bottom-right). */
  from: string;
  to: string;
  /** Soft light behind the subject. */
  glow: string;
}

export const COVER_THEME: Record<string, Theme> = {
  roulette: { from: '#0e3b2b', to: '#05140f', glow: 'rgb(232 196 120 / 0.35)' },
  dice: { from: '#13254d', to: '#060b1a', glow: 'rgb(120 170 255 / 0.32)' },
  mines: { from: '#0b3a3d', to: '#041517', glow: 'rgb(90 230 200 / 0.3)' },
  crash: { from: '#2a1450', to: '#0b0618', glow: 'rgb(190 130 255 / 0.32)' },
  blackjack: { from: '#123b28', to: '#06140d', glow: 'rgb(240 220 170 / 0.28)' },
  limbo: { from: '#43123f', to: '#140513', glow: 'rgb(255 120 200 / 0.3)' },
  keno: { from: '#0f2c52', to: '#050d1c', glow: 'rgb(255 205 110 / 0.3)' },
  plinko: { from: '#4a2a0a', to: '#170b02', glow: 'rgb(255 180 80 / 0.32)' },
  hilo: { from: '#4a1015', to: '#160406', glow: 'rgb(255 140 130 / 0.3)' },
  'lantern-hollow': { from: '#3a2a8a', to: '#0d0824', glow: 'rgb(255 190 110 / 0.34)' },
  'ember-fruits': { from: '#9a2a10', to: '#1a0402', glow: 'rgb(255 200 80 / 0.36)' },
  'sands-of-aurum': { from: '#1f5a96', to: '#07142a', glow: 'rgb(242 201 91 / 0.36)' },
  'coral-deep': { from: '#0f7a8a', to: '#03182a', glow: 'rgb(127 243 224 / 0.34)' },
  'frost-crown': { from: '#3a78c0', to: '#0a1630', glow: 'rgb(220 245 255 / 0.38)' },
};

/** A slot cover: a three-symbol reel window with a gold frame. */
function slotScene(theme: SlotTheme, symbols: [string, string, string]) {
  return (
    <g>
      <rect x="34" y="22" width="132" height="62" rx="9" fill="url(#sg-gold-deep)" />
      <rect x="38" y="26" width="124" height="54" rx="6" fill="#0b0716" opacity="0.85" />
      {symbols.map((sym, i) => (
        <g key={sym} transform={`translate(${42 + i * 40} ${29}) scale(0.48)`}>
          {symbolGraphic(theme, sym)}
        </g>
      ))}
    </g>
  );
}

const FALLBACK: Theme = { from: '#24252c', to: '#0b0c10', glow: 'rgb(199 163 91 / 0.3)' };

function Card({ x, y, rot, rank, suit, red }: { x: number; y: number; rot: number; rank: string; suit: string; red?: boolean }) {
  const ink = red ? '#c0282d' : '#15161a';
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x="-22" y="-31" width="44" height="62" rx="5" fill="#f7f3ea" stroke="#d9cfb8" strokeWidth="0.8" />
      <text x="-15" y="-17" fontSize="11" fontWeight="800" fill={ink} fontFamily="Inter Variable, sans-serif">
        {rank}
      </text>
      <text x="0" y="9" fontSize="22" textAnchor="middle" fill={ink}>
        {suit}
      </text>
    </g>
  );
}

const SCENES: Record<string, ReactNode> = {
  'lantern-hollow': slotScene('lantern-hollow', ['owl', 'lantern', 'moon']),
  'ember-fruits': slotScene('ember-fruits', ['cherry', 'seven', 'star']),
  'sands-of-aurum': slotScene('sands-of-aurum', ['mask', 'sun', 'pyramid']),
  'coral-deep': slotScene('coral-deep', ['turtle', 'chest', 'pearl']),
  'frost-crown': slotScene('frost-crown', ['fox', 'crown', 'snowflake']),
  roulette: (
    <g>
      <circle cx="100" cy="66" r="44" fill="#5a2c0c" />
      <circle cx="100" cy="66" r="40" fill="#0c0b0a" stroke="#d9b25e" strokeWidth="1.2" />
      {Array.from({ length: 37 }, (_, i) => {
        const a0 = ((i * 360) / 37 - 90) * (Math.PI / 180);
        const a1 = (((i + 1) * 360) / 37 - 90) * (Math.PI / 180);
        const ro = 37;
        const ri = 25;
        const p = (r: number, a: number) => `${(100 + r * Math.cos(a)).toFixed(2)} ${(66 + r * Math.sin(a)).toFixed(2)}`;
        return <path key={i} d={`M${p(ro, a0)} A${ro} ${ro} 0 0 1 ${p(ro, a1)} L${p(ri, a1)} A${ri} ${ri} 0 0 0 ${p(ri, a0)}Z`} fill={i === 0 ? '#13804a' : i % 2 ? '#b3261e' : '#141416'} stroke="#d9b25e" strokeWidth="0.35" />;
      })}
      <circle cx="100" cy="66" r="25" fill="#b8722f" stroke="#d9b25e" strokeWidth="0.8" />
      <circle cx="100" cy="66" r="7" fill="#e8cf8a" />
      <circle cx="122" cy="40" r="3" fill="#f6f2ea" />
    </g>
  ),
  dice: (
    <g>
      <g transform="translate(78 70) rotate(-14)">
        <rect x="-24" y="-24" width="48" height="48" rx="10" fill="#e8412f" stroke="#ff8a76" strokeWidth="1" />
        {[
          [-11, -11],
          [11, 11],
          [0, 0],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="4.2" fill="#fff4ef" />
        ))}
      </g>
      <g transform="translate(126 58) rotate(12)">
        <rect x="-21" y="-21" width="42" height="42" rx="9" fill="#f2f0ea" stroke="#ffffff" strokeWidth="1" />
        {[
          [-9, -9],
          [9, -9],
          [-9, 9],
          [9, 9],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.6" fill="#1b2235" />
        ))}
      </g>
    </g>
  ),
  mines: (
    <g>
      {Array.from({ length: 9 }, (_, i) => {
        const x = 64 + (i % 3) * 25;
        const y = 30 + Math.floor(i / 3) * 25;
        const gem = i === 1 || i === 3 || i === 8;
        const mine = i === 5;
        return (
          <g key={i}>
            <rect x={x} y={y} width="21" height="21" rx="5" fill={gem ? '#0f5a52' : mine ? '#3b1414' : '#173033'} stroke={gem ? '#5ee6c8' : mine ? '#e06a62' : '#2b4f52'} strokeWidth="0.9" />
            {gem && <path d={`M${x + 10.5} ${y + 4} l6 5 -6 8 -6 -8z`} fill="#7ff3d8" stroke="#d6fff6" strokeWidth="0.5" />}
            {mine && <circle cx={x + 10.5} cy={y + 10.5} r="5" fill="#e06a62" />}
          </g>
        );
      })}
    </g>
  ),
  crash: (
    <g>
      <path d="M30 108 Q 110 104 150 40" fill="none" stroke="#c99bff" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M30 108 Q 110 104 150 40 L150 112 L30 112 Z" fill="#a46cff" opacity="0.18" />
      <g transform="translate(152 38) rotate(-52)">
        <path d="M0 -12 C 6 -6 6 6 4 10 L -4 10 C -6 6 -6 -6 0 -12 Z" fill="#f4f0ff" />
        <path d="M-4 10 L0 18 L4 10 Z" fill="#ffb24d" />
      </g>
      <text x="44" y="52" fontSize="22" fontWeight="800" fill="#f4eaff" fontFamily="Inter Variable, sans-serif">
        2.47×
      </text>
    </g>
  ),
  blackjack: (
    <g>
      <ellipse cx="100" cy="112" rx="88" ry="26" fill="#0a2a1b" opacity="0.6" />
      <Card x={84} y={64} rot={-10} rank="A" suit="♠" />
      <Card x={116} y={62} rot={9} rank="K" suit="♥" red />
    </g>
  ),
  limbo: (
    <g>
      {[46, 34, 22].map((r, i) => (
        <circle key={r} cx="100" cy="66" r={r} fill="none" stroke="#ff8fd2" strokeOpacity={0.25 + i * 0.25} strokeWidth="1.5" />
      ))}
      <path d="M100 98 L100 38 M88 50 L100 36 L112 50" fill="none" stroke="#ffd1ef" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="150" y="40" fontSize="13" fontWeight="800" textAnchor="middle" fill="#ffe3f4" fontFamily="Inter Variable, sans-serif">
        10.00×
      </text>
    </g>
  ),
  keno: (
    <g>
      {[
        [62, 50, 7, '#ffcf5e'],
        [94, 40, 23, '#ff7b6b'],
        [126, 52, 31, '#7bc4ff'],
        [76, 84, 12, '#86e0a4'],
        [112, 86, 40, '#ffcf5e'],
      ].map(([x, y, n, c]) => (
        <g key={n as number}>
          <circle cx={x as number} cy={y as number} r="15" fill={c as string} />
          <circle cx={x as number} cy={y as number} r="9" fill="#fffaf0" />
          <text x={x as number} y={(y as number) + 3.5} fontSize="10" fontWeight="800" textAnchor="middle" fill="#14213a" fontFamily="Inter Variable, sans-serif">
            {n}
          </text>
        </g>
      ))}
    </g>
  ),
  plinko: (
    <g>
      {Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: row + 3 }, (_, i) => <circle key={`${row}-${i}`} cx={100 - (row + 2) * 9 + i * 18} cy={16 + row * 14} r="2.4" fill="#ffd9a3" />),
      )}
      <circle cx="109" cy="37" r="5" fill="#ff9f2e" stroke="#ffe0b8" strokeWidth="1" />
      {[-2, -1, 0, 1, 2].map((k, i) => (
        <rect key={k} x={100 + k * 22 - 10} y="84" width="20" height="9" rx="3" fill={['#e0484a', '#ff9f2e', '#ffd166', '#ff9f2e', '#e0484a'][i]} />
      ))}
    </g>
  ),
  hilo: (
    <g>
      <Card x={100} y={64} rot={0} rank="7" suit="♦" red />
      <path d="M150 52 l10 -14 l10 14" fill="none" stroke="#9ff0b8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 76 l10 14 l10 -14" fill="none" stroke="#ff9a90" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
};

/** A game's cover: themed background, soft light, and its scene. */
export function GameCover({ id, className, children }: { id: string; className?: string; children?: ReactNode }) {
  const t = COVER_THEME[id] ?? FALLBACK;
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ backgroundImage: `radial-gradient(70% 70% at 50% 42%, ${t.glow}, transparent 70%), linear-gradient(135deg, ${t.from}, ${t.to})` }}>
      <svg viewBox="0 0 200 132" className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        {SCENES[id]}
      </svg>
      {/* Vignette and floor shadow for depth. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_10%,transparent_55%,rgb(0_0_0/0.55))]" aria-hidden="true" />
      {children}
    </div>
  );
}
