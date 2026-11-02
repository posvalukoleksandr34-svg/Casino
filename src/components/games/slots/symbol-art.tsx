/**
 * Original symbol art for the Aurovane video slots, drawn as inline SVG (no
 * image files, no third-party assets). Gradients live once per page in
 * <SlotDefs />; every symbol is a 100×100 drawing that references them.
 */
import type { ReactNode } from 'react';
import type { SlotGameId } from '@/engine/games/slots';

/** Fixed precision: server and browser can differ in the last bits of Math.cos/sin, which breaks hydration. */
const r2 = (n: number) => n.toFixed(2);

export type SlotTheme = SlotGameId;

/** Shared gradients (rendered once per page, hidden, by the root layout). */
export function SlotDefs() {
  const lin = (id: string, stops: [string, string][], x2 = '0', y2 = '1') => (
    <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
      {stops.map(([o, c]) => (
        <stop key={o} offset={o} stopColor={c} />
      ))}
    </linearGradient>
  );
  const rad = (id: string, stops: [string, string][], cx = '40%', cy = '35%') => (
    <radialGradient id={id} cx={cx} cy={cy} r="70%">
      {stops.map(([o, c]) => (
        <stop key={o} offset={o} stopColor={c} />
      ))}
    </radialGradient>
  );
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        {lin('sg-gold', [['0', '#fff3c4'], ['0.45', '#f2c95b'], ['1', '#a8701c']])}
        {lin('sg-gold-deep', [['0', '#ffd977'], ['1', '#7a4b0e']])}
        {lin('sg-purple', [['0', '#e6b8ff'], ['0.5', '#a050e0'], ['1', '#4a1680']])}
        {lin('sg-green', [['0', '#b9ffcf'], ['0.5', '#2fbf6f'], ['1', '#0b5a33']])}
        {lin('sg-red', [['0', '#ffc2b8'], ['0.5', '#e8423a'], ['1', '#7a0f12']])}
        {lin('sg-blue', [['0', '#c6ecff'], ['0.5', '#3a9be8'], ['1', '#0f3c7a']])}
        {lin('sg-orange', [['0', '#ffe2a8'], ['0.5', '#ff9a2e'], ['1', '#a3420a']])}
        {lin('sg-teal', [['0', '#c7fff4'], ['0.5', '#2ec6b0'], ['1', '#0b5650']])}
        {lin('sg-turq', [['0', '#c8fbff'], ['0.5', '#27b6d8'], ['1', '#0d4b78']])}
        {lin('sg-cream', [['0', '#ffffff'], ['1', '#d8cdb6']])}
        {lin('sg-wood', [['0', '#8a5a2b'], ['1', '#3b220c']])}
        {lin('sg-night', [['0', '#3a2a6b'], ['1', '#120a2a']])}
        {lin('sg-feather', [['0', '#4b4f6b'], ['1', '#14152a']])}
        {lin('sg-owl', [['0', '#c99a62'], ['1', '#5c3a1c']])}
        {lin('sg-book', [['0', '#7d3bc4'], ['1', '#2c0d55']])}
        {lin('sg-wax', [['0', '#fff8e7'], ['1', '#d9c7a1']])}
        {lin('sg-sand', [['0', '#ffe6a6'], ['1', '#c08a2c']])}
        {lin('sg-lotus', [['0', '#ffd6ea'], ['1', '#e05a9a']])}
        {rad('sg-flame', [['0', '#fffbe0'], ['0.35', '#ffd34d'], ['0.75', '#ff7a1a'], ['1', '#c22a0a']], '50%', '70%')}
        {rad('sg-moon', [['0', '#fffdf0'], ['0.6', '#f4e7b8'], ['1', '#c7b072']])}
        {rad('sg-glow-amber', [['0', 'rgb(255 214 120 / 0.9)'], ['1', 'rgb(255 160 40 / 0)']], '50%', '50%')}
        {rad('sg-glow-moon', [['0', 'rgb(255 250 220 / 0.7)'], ['1', 'rgb(160 140 255 / 0)']], '50%', '50%')}
        {rad('sg-glow-gold', [['0', 'rgb(255 230 140 / 0.85)'], ['1', 'rgb(255 180 40 / 0)']], '50%', '50%')}
        {rad('sg-plum', [['0', '#e2a6ff'], ['0.6', '#7a2fb0'], ['1', '#3a0f5c']])}
        {rad('sg-orange-fruit', [['0', '#ffe0a0'], ['0.6', '#ff8c1a'], ['1', '#b14b05']])}
        {rad('sg-lemon', [['0', '#fffbd0'], ['0.6', '#ffe14a'], ['1', '#b89a0c']])}
        {rad('sg-lime', [['0', '#eaffc0'], ['0.6', '#7fd23a'], ['1', '#2f6b0d']])}
        {rad('sg-cherry', [['0', '#ffb3b3'], ['0.55', '#e0202a'], ['1', '#6a0510']])}
        {rad('sg-grape', [['0', '#d9b3ff'], ['0.6', '#7a3fd0'], ['1', '#33105e']])}
        {lin('sg-ice', [['0', '#ffffff'], ['0.5', '#bfe8ff'], ['1', '#4a8ccf']])}
        {lin('sg-silver', [['0', '#ffffff'], ['0.5', '#c9d3e0'], ['1', '#6b7a90']])}
        {lin('sg-coral', [['0', '#ffd0b8'], ['0.5', '#ff7a5c'], ['1', '#a8301a']])}
        {lin('sg-sea', [['0', '#b8fff0'], ['0.5', '#2ad1c0'], ['1', '#0b5a6a']])}
        {lin('sg-shell', [['0', '#fff3ea'], ['0.6', '#ffc7a8'], ['1', '#c9785a']])}
        {rad('sg-pearl', [['0', '#ffffff'], ['0.55', '#f1ecf8'], ['1', '#b9add0']])}
        {rad('sg-glow-ice', [['0', 'rgb(220 245 255 / 0.85)'], ['1', 'rgb(120 190 255 / 0)']], '50%', '50%')}
        {rad('sg-glow-sea', [['0', 'rgb(160 255 240 / 0.7)'], ['1', 'rgb(40 180 200 / 0)']], '50%', '50%')}
        {rad('sg-scarab', [['0', '#b8fff2'], ['0.5', '#1fa59a'], ['1', '#0b3d4a']])}
      </defs>
    </svg>
  );
}

/** A royal (A K Q J 10) as a bevelled letter in the theme's colour. */
function Royal({ text, fill, stroke }: { text: string; fill: string; stroke: string }) {
  const size = text.length > 1 ? 56 : 68;
  return (
    <g>
      <text x="50" y="72" textAnchor="middle" fontSize={size} fontWeight="900" fontFamily="Georgia, 'Times New Roman', serif" fill="rgb(0 0 0 / 0.45)" transform="translate(2 3)">
        {text}
      </text>
      <text x="50" y="72" textAnchor="middle" fontSize={size} fontWeight="900" fontFamily="Georgia, 'Times New Roman', serif" fill={fill} stroke={stroke} strokeWidth="2.2" paintOrder="stroke">
        {text}
      </text>
      <text x="50" y="72" textAnchor="middle" fontSize={size} fontWeight="900" fontFamily="Georgia, 'Times New Roman', serif" fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="0.8" transform="translate(-0.8 -1)">
        {text}
      </text>
    </g>
  );
}

function WildBanner({ y = 84, fill = 'url(#sg-gold)' }: { y?: number; fill?: string }) {
  return (
    <g>
      <path d={`M14 ${y - 9} h72 l-5 9 l5 9 h-72 l5 -9z`} fill="#2a0f0f" stroke={fill} strokeWidth="2" />
      <text x="50" y={y + 4.5} textAnchor="middle" fontSize="13" fontWeight="900" letterSpacing="2" fill={fill} fontFamily="Georgia, serif">
        WILD
      </text>
    </g>
  );
}

const ROYAL_COLOURS: Record<SlotTheme, Record<string, [string, string]>> = {
  'lantern-hollow': { ace: ['url(#sg-purple)', '#2a0b4a'], king: ['url(#sg-green)', '#06331c'], queen: ['url(#sg-red)', '#430709'], jack: ['url(#sg-blue)', '#0a2448'], ten: ['url(#sg-orange)', '#4a1d04'] },
  'ember-fruits': {},
  'coral-deep': { ace: ['url(#sg-sea)', '#063a40'], king: ['url(#sg-coral)', '#4a1206'], queen: ['url(#sg-purple)', '#2a0b4a'], jack: ['url(#sg-green)', '#06331c'], ten: ['url(#sg-gold)', '#4a2e06'] },
  'frost-crown': { ace: ['url(#sg-ice)', '#103a66'], king: ['url(#sg-silver)', '#2a3446'], queen: ['url(#sg-purple)', '#2a0b4a'], jack: ['url(#sg-teal)', '#06332f'], ten: ['url(#sg-blue)', '#0a2448'] },
  'sands-of-aurum': { ace: ['url(#sg-turq)', '#082f4d'], king: ['url(#sg-gold)', '#4a2e06'], queen: ['url(#sg-red)', '#430709'], jack: ['url(#sg-teal)', '#06332f'], ten: ['url(#sg-orange)', '#4a1d04'] },
};
const ROYAL_TEXT: Record<string, string> = { ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: '10' };

const ART: Record<string, ReactNode> = {
  // ── Lantern Hollow
  lantern: (
    <g>
      <circle cx="50" cy="44" r="40" fill="url(#sg-glow-amber)" />
      <path d="M50 4 v8" stroke="#3b2a1a" strokeWidth="3" />
      <path d="M38 14 h24 l-3 7 h-18z" fill="url(#sg-gold-deep)" stroke="#3b220c" strokeWidth="1.5" />
      <path d="M36 21 h28 l4 40 h-36z" fill="rgb(255 210 120 / 0.35)" stroke="url(#sg-gold-deep)" strokeWidth="3" />
      <path d="M50 21 v40 M36 41 h32" stroke="url(#sg-gold-deep)" strokeWidth="1.6" opacity="0.8" />
      <path d="M50 30 c-7 9 -6 18 0 22 c6 -4 7 -13 0 -22z" fill="url(#sg-flame)" />
      <path d="M32 61 h36 l-4 7 h-28z" fill="url(#sg-gold-deep)" stroke="#3b220c" strokeWidth="1.5" />
      <WildBanner />
    </g>
  ),
  moon: (
    <g>
      <circle cx="50" cy="48" r="46" fill="url(#sg-glow-moon)" />
      <circle cx="50" cy="48" r="31" fill="url(#sg-moon)" stroke="#fff6cf" strokeWidth="1.5" />
      <circle cx="40" cy="40" r="6" fill="#d9c58c" opacity="0.6" />
      <circle cx="60" cy="57" r="8" fill="#d9c58c" opacity="0.5" />
      <circle cx="58" cy="34" r="3.5" fill="#d9c58c" opacity="0.6" />
      <path d="M16 30 q6 -6 10 0 q4 -6 10 0 q-6 -2 -10 4 q-4 -6 -10 -4z" fill="#1a0f2e" />
      <path d="M66 74 q5 -5 8 0 q3 -5 8 0 q-5 -1.5 -8 3 q-3 -4.5 -8 -3z" fill="#1a0f2e" />
      <text x="50" y="96" textAnchor="middle" fontSize="11" fontWeight="900" letterSpacing="1.5" fill="#fff4c9" stroke="#2a1650" strokeWidth="2.5" paintOrder="stroke" fontFamily="Georgia, serif">
        SCATTER
      </text>
    </g>
  ),
  owl: (
    <g>
      <path d="M22 30 l8 -16 l10 12 h20 l10 -12 l8 16 c6 16 6 40 -6 54 c-8 9 -36 9 -44 0 c-12 -14 -12 -38 -6 -54z" fill="url(#sg-owl)" stroke="#2b1708" strokeWidth="2" />
      <path d="M34 66 q16 10 32 0 q-4 16 -16 18 q-12 -2 -16 -18z" fill="#e8d2a8" opacity="0.9" />
      <path d="M40 70 l3 4 l3 -4 l3 4 l3 -4 l3 4 l3 -4" fill="none" stroke="#8a6a3a" strokeWidth="1.2" />
      <circle cx="37" cy="44" r="13" fill="#f5e7c8" />
      <circle cx="63" cy="44" r="13" fill="#f5e7c8" />
      <circle cx="37" cy="44" r="9" fill="#ffc21a" />
      <circle cx="63" cy="44" r="9" fill="#ffc21a" />
      <circle cx="37" cy="44" r="4.5" fill="#120a04" />
      <circle cx="63" cy="44" r="4.5" fill="#120a04" />
      <circle cx="35" cy="42" r="1.6" fill="#fff" />
      <circle cx="61" cy="42" r="1.6" fill="#fff" />
      <path d="M46 52 l4 9 l4 -9z" fill="#e89a1a" stroke="#6a3a08" strokeWidth="1" />
    </g>
  ),
  raven: (
    <g>
      <path d="M18 62 c4 -22 22 -36 42 -34 c10 1 18 8 20 16 l12 4 l-12 4 c-2 14 -16 26 -36 26 l-14 10 l2 -12 c-8 -2 -14 -8 -14 -14z" fill="url(#sg-feather)" stroke="#05060f" strokeWidth="2" />
      <path d="M30 60 c10 -6 24 -6 34 2 c-10 2 -22 4 -34 -2z" fill="#6b4fb8" opacity="0.55" />
      <path d="M80 44 l12 4 l-12 4z" fill="#3a3d55" />
      <circle cx="68" cy="40" r="4" fill="#ff3b3b" />
      <circle cx="69" cy="39" r="1.3" fill="#fff" />
      <path d="M24 70 c8 4 18 4 26 0" stroke="#8f7bdc" strokeWidth="1.5" fill="none" opacity="0.6" />
    </g>
  ),
  spellbook: (
    <g>
      <path d="M18 22 l52 -8 l12 6 v62 l-52 8 l-12 -6z" fill="url(#sg-book)" stroke="#1a0636" strokeWidth="2" />
      <path d="M30 28 l52 -8 v62 l-52 8z" fill="url(#sg-book)" stroke="url(#sg-gold)" strokeWidth="2.5" />
      <path d="M18 22 l12 6 v62 l-12 -6z" fill="#e9dcc0" />
      <circle cx="56" cy="51" r="14" fill="none" stroke="url(#sg-gold)" strokeWidth="2" />
      <path d="M56 38 l3.5 9 l9.5 0.5 l-7.5 6 l2.5 9 l-8 -5 l-8 5 l2.5 -9 l-7.5 -6 l9.5 -0.5z" fill="url(#sg-gold)" />
      <path d="M34 34 l6 -1 M34 80 l6 -1 M76 26 l-6 1 M76 72 l-6 1" stroke="url(#sg-gold)" strokeWidth="3" />
    </g>
  ),
  candle: (
    <g>
      <circle cx="50" cy="22" r="20" fill="url(#sg-glow-amber)" />
      <path d="M50 8 c-6 8 -6 15 0 19 c6 -4 6 -11 0 -19z" fill="url(#sg-flame)" />
      <path d="M50 26 v6" stroke="#2a1a0a" strokeWidth="2" />
      <path d="M36 32 h28 v52 h-28z" fill="url(#sg-wax)" stroke="#a89466" strokeWidth="1.5" />
      <path d="M36 32 h28 v6 c-3 0 -3 10 -6 10 c-3 0 -3 -6 -6 -6 c-3 0 -3 14 -6 14 c-3 0 -4 -18 -10 -18z" fill="#fffdf6" />
      <path d="M26 84 h48 l-4 8 h-40z" fill="url(#sg-gold-deep)" stroke="#3b220c" strokeWidth="1.5" />
    </g>
  ),

  // ── Ember Fruits
  blaze: (
    <g>
      <circle cx="50" cy="46" r="42" fill="url(#sg-glow-amber)" />
      <path d="M50 8 c6 14 20 18 20 38 c0 14 -9 24 -20 24 c-11 0 -20 -10 -20 -24 c0 -9 5 -15 9 -19 c0 8 3 12 7 13 c-2 -10 -1 -22 4 -32z" fill="url(#sg-flame)" stroke="#8a1a05" strokeWidth="1.5" />
      <path d="M50 38 c4 7 9 9 9 17 c0 6 -4 10 -9 10 c-5 0 -9 -4 -9 -10 c0 -5 3 -7 5 -9 c1 4 2 5 3 5 c-1 -5 0 -9 1 -13z" fill="#fff6c2" />
      <WildBanner />
    </g>
  ),
  star: (
    <g>
      <circle cx="50" cy="46" r="44" fill="url(#sg-glow-gold)" />
      <path d="M50 8 l11 24 l26 3 l-19 18 l5 26 l-23 -13 l-23 13 l5 -26 l-19 -18 l26 -3z" fill="url(#sg-gold)" stroke="#7a4b0e" strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 20 l6 14 l15 2 l-11 10 l3 15 l-13 -8 z" fill="#fff8d8" opacity="0.5" />
      <text x="50" y="96" textAnchor="middle" fontSize="11" fontWeight="900" letterSpacing="1.5" fill="#fff4c9" stroke="#5a1a05" strokeWidth="2.5" paintOrder="stroke" fontFamily="Georgia, serif">
        SCATTER
      </text>
    </g>
  ),
  seven: (
    <g>
      <text x="52" y="86" textAnchor="middle" fontSize="90" fontWeight="900" fontFamily="Georgia, serif" fill="rgb(0 0 0 / 0.4)" transform="translate(2 3)">
        7
      </text>
      <text x="52" y="86" textAnchor="middle" fontSize="90" fontWeight="900" fontFamily="Georgia, serif" fill="url(#sg-red)" stroke="url(#sg-gold)" strokeWidth="4" paintOrder="stroke">
        7
      </text>
    </g>
  ),
  bell: (
    <g>
      <path d="M50 12 c-18 0 -26 16 -26 34 c0 14 -6 20 -12 26 h76 c-6 -6 -12 -12 -12 -26 c0 -18 -8 -34 -26 -34z" fill="url(#sg-gold)" stroke="#7a4b0e" strokeWidth="2" />
      <path d="M36 30 c2 -8 8 -12 14 -12" stroke="#fff6cf" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.8" />
      <circle cx="50" cy="80" r="8" fill="url(#sg-gold-deep)" stroke="#7a4b0e" strokeWidth="1.5" />
      <path d="M44 12 a6 6 0 0 1 12 0" stroke="#7a4b0e" strokeWidth="3" fill="none" />
    </g>
  ),
  melon: (
    <g>
      <path d="M10 40 a40 40 0 0 0 80 0z" fill="#1d7a2c" />
      <path d="M15 40 a35 35 0 0 0 70 0z" fill="#d8f5c0" />
      <path d="M19 40 a31 31 0 0 0 62 0z" fill="url(#sg-red)" />
      {[
        [34, 50],
        [50, 56],
        [66, 50],
        [42, 62],
        [58, 62],
      ].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="2.2" ry="3.4" fill="#1a0a0a" />
      ))}
    </g>
  ),
  grapes: (
    <g>
      <path d="M52 8 c0 8 -2 12 -6 16" stroke="#5a3a12" strokeWidth="3" fill="none" />
      <path d="M54 14 c10 -6 22 -2 24 6 c-10 2 -18 0 -24 -6z" fill="url(#sg-green)" />
      {[
        [36, 32],
        [50, 30],
        [64, 32],
        [30, 46],
        [44, 46],
        [58, 46],
        [70, 46],
        [38, 60],
        [52, 60],
        [64, 60],
        [44, 74],
        [58, 74],
        [51, 87],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="8.5" fill="url(#sg-grape)" stroke="#2a0b4a" strokeWidth="1" />
      ))}
    </g>
  ),
  plum: (
    <g>
      <path d="M50 18 c2 -6 6 -10 12 -10" stroke="#5a3a12" strokeWidth="3" fill="none" />
      <path d="M54 16 c8 -8 20 -6 22 2 c-8 4 -16 4 -22 -2z" fill="url(#sg-green)" />
      <ellipse cx="50" cy="56" rx="32" ry="34" fill="url(#sg-plum)" stroke="#2a0b4a" strokeWidth="1.5" />
      <path d="M50 24 c-6 10 -6 50 0 64" stroke="#3a0f5c" strokeWidth="1.5" fill="none" opacity="0.6" />
      <ellipse cx="38" cy="42" rx="6" ry="10" fill="#fff" opacity="0.25" />
    </g>
  ),
  orange: (
    <g>
      <circle cx="50" cy="54" r="34" fill="url(#sg-orange-fruit)" stroke="#7a3205" strokeWidth="1.5" />
      <path d="M50 20 c4 -6 12 -8 18 -6 c-4 6 -12 8 -18 6z" fill="url(#sg-green)" />
      {[...Array(10)].map((_, i) => (
        <circle key={i} cx={40 + (i % 4) * 7} cy={44 + Math.floor(i / 4) * 9} r="0.9" fill="#b14b05" opacity="0.6" />
      ))}
      <ellipse cx="38" cy="40" rx="7" ry="9" fill="#fff" opacity="0.22" />
    </g>
  ),
  lemon: (
    <g>
      <path d="M10 52 c4 -24 26 -36 40 -36 c14 0 36 12 40 36 c-4 24 -26 34 -40 34 c-14 0 -36 -10 -40 -34z" fill="url(#sg-lemon)" stroke="#8a7205" strokeWidth="1.5" />
      <path d="M10 52 l-4 2 l4 2 M90 52 l4 -2 l-4 -2" stroke="#b89a0c" strokeWidth="3" />
      <ellipse cx="38" cy="40" rx="10" ry="6" fill="#fff" opacity="0.3" />
    </g>
  ),
  cherry: (
    <g>
      <path d="M58 10 c-4 16 -16 30 -26 44 M58 10 c4 16 8 30 14 42" stroke="#3a6b12" strokeWidth="3" fill="none" />
      <path d="M58 10 c10 -6 22 -4 26 4 c-10 4 -20 2 -26 -4z" fill="url(#sg-green)" />
      <circle cx="32" cy="66" r="20" fill="url(#sg-cherry)" stroke="#4a020a" strokeWidth="1.5" />
      <circle cx="70" cy="64" r="20" fill="url(#sg-cherry)" stroke="#4a020a" strokeWidth="1.5" />
      <ellipse cx="25" cy="58" rx="5" ry="7" fill="#fff" opacity="0.35" />
      <ellipse cx="63" cy="56" rx="5" ry="7" fill="#fff" opacity="0.35" />
    </g>
  ),
  lime: (
    <g>
      <circle cx="50" cy="52" r="34" fill="url(#sg-lime)" stroke="#2f6b0d" strokeWidth="1.5" />
      <circle cx="50" cy="52" r="24" fill="#e9ffc8" opacity="0.85" />
      {[...Array(8)].map((_, i) => {
        const a = (i * Math.PI) / 4;
        return <path key={i} d={`M50 52 L${r2(50 + 22 * Math.cos(a))} ${r2(52 + 22 * Math.sin(a))}`} stroke="#7fd23a" strokeWidth="2.5" />;
      })}
      <circle cx="50" cy="52" r="3" fill="#7fd23a" />
    </g>
  ),

  // ── Sands of Aurum
  sun: (
    <g>
      <circle cx="50" cy="44" r="44" fill="url(#sg-glow-gold)" />
      {[...Array(12)].map((_, i) => {
        const a = (i * Math.PI) / 6;
        return <path key={i} d={`M${r2(50 + 24 * Math.cos(a))} ${r2(44 + 24 * Math.sin(a))} L${r2(50 + 38 * Math.cos(a + 0.12))} ${r2(44 + 38 * Math.sin(a + 0.12))} L${r2(50 + 38 * Math.cos(a - 0.12))} ${r2(44 + 38 * Math.sin(a - 0.12))}z`} fill="url(#sg-gold)" />;
      })}
      <circle cx="50" cy="44" r="22" fill="url(#sg-gold)" stroke="#7a4b0e" strokeWidth="2" />
      <circle cx="50" cy="44" r="14" fill="none" stroke="#7a4b0e" strokeWidth="1.5" />
      <circle cx="50" cy="44" r="6" fill="url(#sg-red)" />
      <WildBanner />
    </g>
  ),
  pyramid: (
    <g>
      <circle cx="50" cy="40" r="40" fill="url(#sg-glow-gold)" />
      <circle cx="68" cy="26" r="10" fill="url(#sg-gold)" />
      <path d="M50 14 l40 62 h-80z" fill="url(#sg-sand)" stroke="#6a4510" strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 14 l40 62 h-30z" fill="#9a6a20" opacity="0.45" />
      <path d="M26 52 h48 M18 64 h64 M34 40 h32 M42 28 h16" stroke="#7a5214" strokeWidth="1" opacity="0.6" />
      <path d="M50 14 l4 6 h-8z" fill="url(#sg-gold)" />
      <text x="50" y="96" textAnchor="middle" fontSize="11" fontWeight="900" letterSpacing="1.5" fill="#fff4c9" stroke="#3a2205" strokeWidth="2.5" paintOrder="stroke" fontFamily="Georgia, serif">
        SCATTER
      </text>
    </g>
  ),
  mask: (
    <g>
      <path d="M18 30 c0 -14 14 -24 32 -24 c18 0 32 10 32 24 v26 l8 30 h-80 l8 -30z" fill="url(#sg-gold)" stroke="#6a4510" strokeWidth="2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${12 + i * 1.5} ${60 + i * 6} h${76 - i * 3}`} stroke="url(#sg-turq)" strokeWidth="3.2" />
      ))}
      <path d="M32 30 c0 -10 8 -16 18 -16 c10 0 18 6 18 16 v20 c0 12 -8 22 -18 22 c-10 0 -18 -10 -18 -22z" fill="url(#sg-gold-deep)" stroke="#6a4510" strokeWidth="1.5" />
      <path d="M36 38 q6 -4 12 0 q-6 3 -12 0z M52 38 q6 -4 12 0 q-6 3 -12 0z" fill="#10202e" />
      <path d="M48 44 l2 10 l2 -10" stroke="#6a4510" strokeWidth="1.5" fill="none" />
      <path d="M44 60 q6 3 12 0" stroke="#6a4510" strokeWidth="1.8" fill="none" />
      <path d="M46 72 h8 v12 h-8z" fill="url(#sg-turq)" stroke="#6a4510" strokeWidth="1" />
    </g>
  ),
  scarab: (
    <g>
      <path d="M10 46 c10 -16 22 -18 28 -12 M90 46 c-10 -16 -22 -18 -28 -12" stroke="url(#sg-gold)" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M8 40 c6 -12 18 -16 26 -10 l-4 18 c-10 0 -18 -2 -22 -8z M92 40 c-6 -12 -18 -16 -26 -10 l4 18 c10 0 18 -2 22 -8z" fill="url(#sg-turq)" stroke="#0d4b78" strokeWidth="1" opacity="0.9" />
      <ellipse cx="50" cy="58" rx="20" ry="26" fill="url(#sg-scarab)" stroke="#063038" strokeWidth="2" />
      <path d="M50 34 v48" stroke="#063038" strokeWidth="2" />
      <circle cx="50" cy="26" r="9" fill="url(#sg-scarab)" stroke="#063038" strokeWidth="2" />
      <circle cx="50" cy="16" r="7" fill="url(#sg-red)" stroke="#6a4510" strokeWidth="1.5" />
      <path d="M32 70 l-10 10 M68 70 l10 10 M30 56 l-12 2 M70 56 l12 2" stroke="url(#sg-gold)" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  ankh: (
    <g>
      <circle cx="50" cy="48" r="40" fill="url(#sg-glow-gold)" opacity="0.7" />
      <path
        d="M50 8 c-12 0 -18 10 -18 20 c0 8 5 14 10 18 h-20 v10 h22 v38 h12 v-38 h22 v-10 h-20 c5 -4 10 -10 10 -18 c0 -10 -6 -20 -18 -20z M50 18 c5 0 8 5 8 10 c0 6 -4 12 -8 14 c-4 -2 -8 -8 -8 -14 c0 -5 3 -10 8 -10z"
        fill="url(#sg-gold)"
        stroke="#6a4510"
        strokeWidth="2"
        fillRule="evenodd"
      />
    </g>
  ),
  lotus: (
    <g>
      <path d="M10 76 c20 6 60 6 80 0 c-6 10 -24 14 -40 14 c-16 0 -34 -4 -40 -14z" fill="url(#sg-teal)" />
      <path d="M50 14 c10 12 14 28 0 58 c-14 -30 -10 -46 0 -58z" fill="url(#sg-lotus)" stroke="#9a2a5e" strokeWidth="1.5" />
      <path d="M50 72 c-6 -22 -18 -36 -32 -40 c-2 18 10 36 32 40z M50 72 c6 -22 18 -36 32 -40 c2 18 -10 36 -32 40z" fill="url(#sg-lotus)" stroke="#9a2a5e" strokeWidth="1.5" />
      <path d="M50 74 c-14 -6 -28 -8 -40 -2 c10 8 26 8 40 2z M50 74 c14 -6 28 -8 40 -2 c-10 8 -26 8 -40 2z" fill="#f7a8cf" stroke="#9a2a5e" strokeWidth="1.2" />
      <circle cx="50" cy="66" r="5" fill="url(#sg-gold)" />
    </g>
  ),

  // ── Coral Deep
  chest: (
    <g>
      <circle cx="50" cy="46" r="42" fill="url(#sg-glow-gold)" />
      <path d="M16 44 c0 -18 14 -26 34 -26 c20 0 34 8 34 26z" fill="url(#sg-wood)" stroke="#2a1606" strokeWidth="2" />
      <path d="M16 44 h68 v30 h-68z" fill="url(#sg-wood)" stroke="#2a1606" strokeWidth="2" />
      <path d="M16 44 h68" stroke="url(#sg-gold)" strokeWidth="4" />
      <path d="M24 22 v52 M76 22 v52" stroke="url(#sg-gold)" strokeWidth="3.5" />
      <rect x="44" y="40" width="12" height="14" rx="2" fill="url(#sg-gold)" stroke="#6a4510" strokeWidth="1" />
      <circle cx="34" cy="38" r="4" fill="url(#sg-pearl)" />
      <circle cx="62" cy="36" r="3.5" fill="url(#sg-pearl)" />
      <path d="M40 36 l4 -6 l4 6z" fill="#ff5a7a" />
      <WildBanner />
    </g>
  ),
  pearl: (
    <g>
      <circle cx="50" cy="44" r="44" fill="url(#sg-glow-sea)" />
      <path d="M12 58 c4 -26 22 -38 38 -38 c16 0 34 12 38 38 c-8 6 -24 10 -38 10 c-14 0 -30 -4 -38 -10z" fill="url(#sg-shell)" stroke="#9a4a2e" strokeWidth="1.5" />
      {[24, 37, 50, 63, 76].map((x) => (
        <path key={x} d={`M50 24 L${x} 64`} stroke="#c9785a" strokeWidth="1.2" opacity="0.7" />
      ))}
      <circle cx="50" cy="56" r="14" fill="url(#sg-pearl)" stroke="#fff" strokeWidth="1" />
      <circle cx="45" cy="51" r="4" fill="#fff" opacity="0.9" />
      <text x="50" y="96" textAnchor="middle" fontSize="11" fontWeight="900" letterSpacing="1.5" fill="#e9fffb" stroke="#063a40" strokeWidth="2.5" paintOrder="stroke" fontFamily="Georgia, serif">
        SCATTER
      </text>
    </g>
  ),
  turtle: (
    <g>
      <path d="M22 40 l-12 -8 l4 14z M78 40 l12 -8 l-4 14z M24 70 l-12 10 l14 -2z M76 70 l12 10 l-14 -2z" fill="url(#sg-green)" stroke="#0b3a20" strokeWidth="1.5" />
      <ellipse cx="50" cy="55" rx="30" ry="24" fill="url(#sg-green)" stroke="#0b3a20" strokeWidth="2" />
      <path d="M50 33 l10 10 l-4 14 h-12 l-4 -14z M36 46 l8 -3 l4 14 l-8 8 l-10 -6z M64 46 l-8 -3 l-4 14 l8 8 l10 -6z" fill="#7a5a2a" stroke="#3a2a10" strokeWidth="1.2" opacity="0.85" />
      <ellipse cx="50" cy="22" rx="10" ry="9" fill="url(#sg-green)" stroke="#0b3a20" strokeWidth="1.5" />
      <circle cx="46" cy="20" r="2" fill="#0b1a10" />
      <circle cx="54" cy="20" r="2" fill="#0b1a10" />
    </g>
  ),
  seahorse: (
    <g>
      <path d="M56 12 c12 2 16 14 10 22 c-4 6 -12 6 -12 14 c0 8 12 10 12 22 c0 10 -10 18 -20 14 c-6 -2 -6 -10 0 -10 c6 0 8 -6 4 -10 c-8 -8 -18 -14 -14 -30 c2 -10 10 -14 16 -14 l-8 -6z" fill="url(#sg-orange)" stroke="#7a3205" strokeWidth="2" />
      <path d="M66 22 l14 -2 l-12 6z" fill="url(#sg-orange)" stroke="#7a3205" strokeWidth="1.2" />
      <circle cx="58" cy="22" r="2.6" fill="#1a0a04" />
      {[30, 40, 50, 60].map((y) => (
        <path key={y} d={`M${44 + (y - 30) / 5} ${y} h10`} stroke="#ffd9a8" strokeWidth="1.4" opacity="0.7" />
      ))}
      <path d="M40 40 c-8 2 -10 10 -6 14" stroke="#ffb066" strokeWidth="3" fill="none" />
    </g>
  ),
  puffer: (
    <g>
      <circle cx="48" cy="52" r="30" fill="url(#sg-lemon)" stroke="#8a7205" strokeWidth="2" />
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i * Math.PI * 2) / 14;
        return <path key={i} d={`M${r2(48 + 30 * Math.cos(a))} ${r2(52 + 30 * Math.sin(a))} l${r2(8 * Math.cos(a))} ${r2(8 * Math.sin(a))}`} stroke="#8a7205" strokeWidth="2.5" strokeLinecap="round" />;
      })}
      <path d="M78 52 l14 -10 v20z" fill="url(#sg-orange)" stroke="#7a3205" strokeWidth="1.5" />
      <circle cx="38" cy="44" r="7" fill="#fff" />
      <circle cx="37" cy="44" r="3.5" fill="#101418" />
      <ellipse cx="28" cy="58" rx="4" ry="3" fill="#e05a2a" />
    </g>
  ),
  shell: (
    <g>
      <path d="M50 12 c22 0 38 18 38 40 c0 14 -8 26 -14 30 h-48 c-6 -4 -14 -16 -14 -30 c0 -22 16 -40 38 -40z" fill="url(#sg-coral)" stroke="#7a1f0e" strokeWidth="2" />
      {[-30, -15, 0, 15, 30].map((dx) => (
        <path key={dx} d={`M50 84 Q${50 + dx * 1.2} 50 ${50 + dx} 14`} stroke="#ffd0b8" strokeWidth="2" fill="none" opacity="0.8" />
      ))}
      <path d="M36 82 h28 l-6 8 h-16z" fill="url(#sg-shell)" stroke="#7a1f0e" strokeWidth="1.5" />
    </g>
  ),

  // ── Frost Crown
  crown: (
    <g>
      <circle cx="50" cy="44" r="44" fill="url(#sg-glow-ice)" />
      <path d="M16 66 l-4 -38 l18 16 l20 -26 l20 26 l18 -16 l-4 38z" fill="url(#sg-ice)" stroke="#2a5a8a" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 66 h68 v8 h-68z" fill="url(#sg-silver)" stroke="#2a5a8a" strokeWidth="1.5" />
      {[30, 50, 70].map((x, i) => (
        <path key={x} d={`M${x} ${i === 1 ? 40 : 48} l5 7 l-5 7 l-5 -7z`} fill={i === 1 ? '#7fd4ff' : '#c8f0ff'} stroke="#2a5a8a" strokeWidth="1" />
      ))}
      <circle cx="12" cy="28" r="3" fill="#fff" />
      <circle cx="50" cy="18" r="3.5" fill="#fff" />
      <circle cx="88" cy="28" r="3" fill="#fff" />
      <WildBanner fill="url(#sg-ice)" />
    </g>
  ),
  snowflake: (
    <g>
      <circle cx="50" cy="44" r="44" fill="url(#sg-glow-ice)" />
      {[0, 60, 120].map((a) => (
        <g key={a} transform={`rotate(${a} 50 44)`}>
          <path d="M50 10 v68" stroke="url(#sg-ice)" strokeWidth="5" strokeLinecap="round" />
          <path d="M50 22 l-8 -8 M50 22 l8 -8 M50 66 l-8 8 M50 66 l8 8 M50 32 l-6 -5 M50 32 l6 -5 M50 56 l-6 5 M50 56 l6 5" stroke="#e8f8ff" strokeWidth="3" strokeLinecap="round" />
        </g>
      ))}
      <circle cx="50" cy="44" r="7" fill="#fff" stroke="#7fbfff" strokeWidth="1.5" />
      <text x="50" y="96" textAnchor="middle" fontSize="11" fontWeight="900" letterSpacing="1.5" fill="#f0fbff" stroke="#103a66" strokeWidth="2.5" paintOrder="stroke" fontFamily="Georgia, serif">
        SCATTER
      </text>
    </g>
  ),
  fox: (
    <g>
      <path d="M20 14 l14 26 l-10 6z M80 14 l-14 26 l10 6z" fill="url(#sg-silver)" stroke="#5a6a80" strokeWidth="1.5" />
      <path d="M22 18 l10 20 M78 18 l-10 20" stroke="#ffc7d6" strokeWidth="3" />
      <path d="M50 88 c-18 -6 -32 -22 -32 -40 c0 -10 6 -14 12 -12 c6 2 12 6 20 6 c8 0 14 -4 20 -6 c6 -2 12 2 12 12 c0 18 -14 34 -32 40z" fill="url(#sg-silver)" stroke="#5a6a80" strokeWidth="2" />
      <path d="M50 88 c-8 -4 -14 -12 -14 -20 c6 4 10 4 14 4 c4 0 8 0 14 -4 c0 8 -6 16 -14 20z" fill="#ffffff" />
      <path d="M32 52 q6 -6 12 0 q-6 4 -12 0z M56 52 q6 -6 12 0 q-6 4 -12 0z" fill="#3aa0ff" />
      <circle cx="38" cy="51" r="1.8" fill="#0b1a2a" />
      <circle cx="62" cy="51" r="1.8" fill="#0b1a2a" />
      <path d="M46 70 h8 l-4 5z" fill="#1a2030" />
    </g>
  ),
  'ice-crystal': (
    <g>
      <circle cx="50" cy="50" r="40" fill="url(#sg-glow-ice)" />
      <path d="M50 8 l22 26 l-8 52 h-28 l-8 -52z" fill="url(#sg-ice)" stroke="#2a5a8a" strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 8 l-8 26 l8 52 l8 -52z" fill="#ffffff" opacity="0.5" />
      <path d="M28 34 h44 M42 34 l8 52 M58 34 l-8 52" stroke="#2a5a8a" strokeWidth="1" opacity="0.6" />
      <circle cx="40" cy="24" r="2.5" fill="#fff" />
    </g>
  ),
  'snow-globe': (
    <g>
      <circle cx="50" cy="42" r="32" fill="rgb(200 235 255 / 0.25)" stroke="url(#sg-ice)" strokeWidth="3" />
      <path d="M50 22 l14 22 h-8 l10 14 h-32 l10 -14 h-8z" fill="url(#sg-green)" stroke="#0b3a20" strokeWidth="1.2" />
      <path d="M22 60 c10 -6 46 -6 56 0 c-6 10 -18 14 -28 14 c-10 0 -22 -4 -28 -14z" fill="#ffffff" />
      {[[34, 30], [66, 28], [40, 50], [62, 48], [50, 18], [30, 44]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.6" fill="#fff" />
      ))}
      <path d="M24 74 h52 l-6 14 h-40z" fill="url(#sg-wood)" stroke="#2a1606" strokeWidth="1.5" />
      <path d="M30 80 h40" stroke="url(#sg-gold)" strokeWidth="2" />
    </g>
  ),
  cocoa: (
    <g>
      <path d="M38 8 c-6 6 6 10 0 16 M52 6 c-6 6 6 10 0 16 M66 8 c-6 6 6 10 0 16" stroke="#e8f4ff" strokeWidth="2.5" fill="none" opacity="0.8" strokeLinecap="round" />
      <path d="M20 30 h60 l-6 52 c-1 6 -6 10 -12 10 h-24 c-6 0 -11 -4 -12 -10z" fill="url(#sg-red)" stroke="#5a0a0e" strokeWidth="2" />
      <path d="M80 42 c14 0 14 26 -4 26" stroke="url(#sg-red)" strokeWidth="6" fill="none" />
      <ellipse cx="50" cy="32" rx="30" ry="6" fill="#5a2a12" />
      <circle cx="40" cy="31" r="5" fill="#fff" />
      <circle cx="52" cy="30" r="5.5" fill="#fff" />
      <circle cx="62" cy="32" r="4" fill="#ffe0ec" />
      <path d="M30 56 h40 M32 66 h36" stroke="#ffffff" strokeWidth="3" strokeDasharray="6 5" opacity="0.8" />
    </g>
  ),
};

/** The drawing of one symbol (100×100 units) for use inside another SVG. */
export function symbolGraphic(theme: SlotTheme, symbol: string): ReactNode {
  const royal = ROYAL_TEXT[symbol];
  const colours = ROYAL_COLOURS[theme][symbol];
  if (royal && colours) return <Royal text={royal} fill={colours[0]} stroke={colours[1]} />;
  return (
    ART[symbol] ?? (
      <text x="50" y="60" textAnchor="middle" fill="#fff">
        {symbol}
      </text>
    )
  );
}

/** One symbol's drawing for a theme (royals take the theme's colours). */
export function SymbolArt({ theme, symbol, className }: { theme: SlotTheme; symbol: string; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      {symbolGraphic(theme, symbol)}
    </svg>
  );
}
