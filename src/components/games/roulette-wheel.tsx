'use client';

import { useEffect, useRef, useState } from 'react';
import { pocketColor, WHEEL_ORDER } from '@/engine/games/roulette/rules';

const SECTOR = 360 / WHEEL_ORDER.length;
const FILL = { red: '#b8322c', black: '#17181c', green: '#1f7a4d' } as const;

function polar(r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)] as const;
}

/**
 * Purely presentational wheel. It is told the authoritative result and
 * animates to it; it never chooses an outcome.
 */
export function RouletteWheel({ result, spinKey, reduced, onSettled }: { result: number | null; spinKey: string | null; reduced: boolean; onSettled: () => void }) {
  const [rotation, setRotation] = useState(0);
  const [animating, setAnimating] = useState(false);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    if (result === null || spinKey === null) return;
    const index = WHEEL_ORDER.indexOf(result);
    const targetMod = (((-index * SECTOR) % 360) + 360) % 360;
    setRotation((r) => {
      const currentMod = ((r % 360) + 360) % 360;
      const delta = (targetMod - currentMod + 360) % 360;
      return r + (reduced ? 0 : 6 * 360) + delta;
    });
    if (reduced) {
      settledRef.current();
      return;
    }
    setAnimating(true);
    const t = setTimeout(() => {
      setAnimating(false);
      settledRef.current();
    }, 3700);
    return () => clearTimeout(t);
  }, [spinKey, result, reduced]);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgb(199_163_91/0.18),transparent_70%)] blur-2xl" aria-hidden="true" />
      <svg viewBox="0 0 200 200" className="relative size-full drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]" role="img" aria-label={result === null ? 'Roulette wheel' : `Roulette wheel showing ${result}`}>
        <defs>
          <radialGradient id="rw-rim" cx="50%" cy="50%" r="50%">
            <stop offset="0.82" stopColor="#3a2e17" />
            <stop offset="0.9" stopColor="#c7a35b" />
            <stop offset="1" stopColor="#4a3c1f" />
          </radialGradient>
          <radialGradient id="rw-hub" cx="40%" cy="35%" r="70%">
            <stop offset="0" stopColor="#f3e6c2" />
            <stop offset="0.5" stopColor="#c7a35b" />
            <stop offset="1" stopColor="#4a3c1f" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="99" fill="url(#rw-rim)" />
        <g
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: '100px 100px',
            transition: animating ? 'transform 3.6s cubic-bezier(0.12, 0.8, 0.18, 1)' : 'none',
          }}
        >
          {WHEEL_ORDER.map((n, i) => {
            const a0 = i * SECTOR - SECTOR / 2;
            const a1 = a0 + SECTOR;
            const [x0, y0] = polar(90, a0);
            const [x1, y1] = polar(90, a1);
            const [x2, y2] = polar(58, a1);
            const [x3, y3] = polar(58, a0);
            const [tx, ty] = polar(80, i * SECTOR);
            return (
              <g key={n}>
                <path d={`M${x0} ${y0} A90 90 0 0 1 ${x1} ${y1} L${x2} ${y2} A58 58 0 0 0 ${x3} ${y3}Z`} fill={FILL[pocketColor(n)]} stroke="#c7a35b" strokeOpacity="0.45" strokeWidth="0.4" />
                <text x={tx} y={ty} fill="#ebe8e2" fontSize="6.4" fontWeight="600" textAnchor="middle" dominantBaseline="central" transform={`rotate(${i * SECTOR} ${tx} ${ty})`} fontFamily="Inter Variable, sans-serif">
                  {n}
                </text>
              </g>
            );
          })}
          <circle cx="100" cy="100" r="58" fill="#101114" stroke="#c7a35b" strokeOpacity="0.5" strokeWidth="0.6" />
          {Array.from({ length: 8 }, (_, i) => {
            const [x, y] = polar(44, i * 45);
            return <line key={i} x1="100" y1="100" x2={x} y2={y} stroke="#c7a35b" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />;
          })}
          <circle cx="100" cy="100" r="13" fill="url(#rw-hub)" />
        </g>
        <path d="M100 13 L94 1 L106 1 Z" fill="#ebe8e2" stroke="#0a0b0d" strokeWidth="0.8" />
        {result !== null && !animating && <circle cx="100" cy="17" r="3.2" fill="#f8f6f1" stroke="#0a0b0d" strokeWidth="0.6" />}
      </svg>
    </div>
  );
}
