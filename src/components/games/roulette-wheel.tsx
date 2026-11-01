'use client';

import { useEffect, useRef, useState } from 'react';
import { pocketColor, WHEEL_ORDER } from '@/engine/games/roulette/rules';
import {
  angleForPocket,
  approachSpeed,
  BALL_POCKET_R,
  IDLE_DEG_PER_SEC,
  mod,
  pocketAtAngle,
  pocketIndexUnderBall,
  REVEAL_HOLD_MS,
  SECTOR,
  SPIN_MS,
  spinFrame,
  spinStartSlope,
  spinTarget,
  WINDUP_DEG_PER_SEC,
} from './wheel-motion';

/** Number ring and pocket floor colours (pocket floors slightly deeper). */
const FILL = { red: '#b3261e', black: '#121214', green: '#13804a' } as const;
const POCKET = { red: '#8f1d17', black: '#0a0a0b', green: '#0d6238' } as const;

function polar(r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)] as const;
}

export type WheelPhase = 'idle' | 'spinning' | 'landed';

export interface WheelSpin {
  /** The round id: each id is animated (and reported settled) exactly once. */
  id: string;
  /** The server's result. */
  result: number;
}

interface Motion {
  mode: WheelPhase;
  rotation: number;
  from: number;
  to: number;
  spinStart: number;
  landedAt: number;
  /** Current speed outside a spin, °/s. */
  speed: number;
  /** Start slope of the current spin (carries the wind-up speed into it). */
  slope: number;
  last: number;
  /** Wheel index of the pocket holding the ball, or null (no ball shown). */
  ballIndex: number | null;
  tickIndex: number;
  dropped: boolean;
}

/**
 * The roulette wheel. It turns slowly on its own while players bet (purely
 * decorative: no request, no chips, no result), winds up when betting has
 * closed on a wager, spins to the authoritative result when it is given one
 * (carrying its current speed into the spin), holds the result, then eases
 * back to idle.
 *
 * Frames are drawn by mutating SVG attributes from requestAnimationFrame, so
 * React does not re-render per frame. With reduced motion there is no idle
 * motion and a result is shown at once.
 */
export function RouletteWheel({
  spin,
  windup = false,
  reduced,
  onSettled,
  onSpinStart,
  onBallDrop,
  onTick,
}: {
  spin: WheelSpin | null;
  /** Betting has closed on a wager: speed up while the server answers. Decorative only. */
  windup?: boolean;
  reduced: boolean;
  onSettled: (id: string) => void;
  onSpinStart?: () => void;
  onBallDrop?: () => void;
  onTick?: () => void;
}) {
  const [phase, setPhase] = useState<WheelPhase>(reduced ? 'landed' : 'idle');
  const [landed, setLanded] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const wheel = useRef<SVGGElement>(null);
  const ball = useRef<SVGCircleElement>(null);
  const raf = useRef<number | null>(null);
  const handled = useRef<string | null>(null);
  const spinId = useRef<string | null>(null);
  const motion = useRef<Motion>({ mode: 'idle', rotation: 0, from: 0, to: 0, spinStart: 0, landedAt: 0, speed: IDLE_DEG_PER_SEC, slope: 0, last: 0, ballIndex: null, tickIndex: -1, dropped: false });
  const callbacks = useRef({ onSettled, onSpinStart, onBallDrop, onTick });
  callbacks.current = { onSettled, onSpinStart, onBallDrop, onTick };
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const windupRef = useRef(windup);
  windupRef.current = windup;

  /** Writes the current motion state to the SVG. */
  const draw = (ballAngle?: number, ballRadius?: number) => {
    const m = motion.current;
    wheel.current?.setAttribute('transform', `rotate(${m.rotation.toFixed(3)} 100 100)`);
    const b = ball.current;
    if (!b) return;
    let angle = ballAngle;
    let radius = ballRadius;
    if (angle === undefined && m.ballIndex !== null) {
      angle = m.rotation + m.ballIndex * SECTOR;
      radius = BALL_POCKET_R;
    }
    if (angle === undefined || radius === undefined) {
      b.setAttribute('visibility', 'hidden');
      return;
    }
    const [x, y] = polar(radius, angle);
    b.setAttribute('cx', x.toFixed(2));
    b.setAttribute('cy', y.toFixed(2));
    b.setAttribute('visibility', 'visible');
  };

  /** Lands the current spin exactly on its target and reports it once. */
  const land = (now: number) => {
    const m = motion.current;
    if (m.mode !== 'spinning') return;
    m.rotation = m.to;
    m.mode = 'landed';
    m.landedAt = now;
    m.speed = 0;
    const id = spinId.current;
    // Read back from the geometry: the pocket physically under the pointer.
    const result = id !== null ? pocketAtAngle(m.to) : null;
    m.ballIndex = result !== null ? WHEEL_ORDER.indexOf(result) : null;
    draw();
    root.current?.setAttribute('data-rotation', mod(m.rotation, 360).toFixed(3));
    setPhase('landed');
    setLanded(result);
    if (id !== null) callbacks.current.onSettled(id);
  };

  const loop = (now: number) => {
    const m = motion.current;
    const dt = Math.min(100, Math.max(0, now - (m.last || now)));
    m.last = now;
    if (m.mode === 'idle') {
      m.speed = approachSpeed(m.speed, windupRef.current ? WINDUP_DEG_PER_SEC : IDLE_DEG_PER_SEC, dt, windupRef.current ? 900 : 1200);
      m.rotation += (m.speed * dt) / 1000;
      draw();
    } else if (m.mode === 'spinning') {
      const p = (now - m.spinStart) / SPIN_MS;
      if (p >= 1) land(now);
      else {
        const f = spinFrame(p, m.from, m.to, m.slope);
        m.rotation = f.wheel;
        draw(f.ball, f.ballRadius);
        if (!m.dropped && f.ballRadius < 90) {
          m.dropped = true;
          callbacks.current.onBallDrop?.();
        }
        if (m.dropped) {
          const idx = pocketIndexUnderBall(f.wheel, f.ball);
          if (idx !== m.tickIndex) {
            m.tickIndex = idx;
            callbacks.current.onTick?.();
          }
        }
      }
    } else if (now - m.landedAt >= REVEAL_HOLD_MS) {
      m.mode = 'idle';
      m.speed = 0;
      setPhase('idle');
    }
    raf.current = requestAnimationFrame(loop);
  };

  // Idle motion runs while mounted (unless reduced motion is on).
  useEffect(() => {
    const m = motion.current;
    if (reduced) {
      if (m.mode === 'spinning') land(performance.now());
      if (m.mode === 'idle') {
        m.mode = 'landed';
        setPhase('landed');
      }
      draw();
      return;
    }
    if (m.mode === 'landed' && spinId.current === null) {
      m.mode = 'idle';
      setPhase('idle');
    }
    m.last = 0;
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // A new authoritative result: spin to it (once per round id).
  useEffect(() => {
    if (!spin || handled.current === spin.id) return;
    handled.current = spin.id;
    spinId.current = spin.id;
    const m = motion.current;
    const now = performance.now();
    if (reducedRef.current) {
      m.mode = 'spinning';
      m.to = m.rotation + mod(angleForPocket(spin.result) - mod(m.rotation, 360), 360);
      land(now);
      return;
    }
    m.mode = 'spinning';
    m.from = m.rotation;
    m.to = spinTarget(m.rotation, spin.result);
    m.slope = spinStartSlope(m.speed, m.from, m.to);
    m.spinStart = now;
    m.ballIndex = null;
    m.tickIndex = -1;
    m.dropped = false;
    setPhase('spinning');
    setLanded(null);
    root.current?.removeAttribute('data-rotation');
    callbacks.current.onSpinStart?.();
    // Safety net: if frames stop (e.g. a background tab), still settle.
    const t = setTimeout(() => land(performance.now()), SPIN_MS + 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin?.id]);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  return (
    <div ref={root} className="relative mx-auto aspect-square w-full max-w-[420px]" data-testid="roulette-wheel" data-state={phase} data-landed={landed ?? undefined}>
      {/* Table shadow under the bowl. */}
      <div className="absolute inset-x-[6%] bottom-[2%] top-[22%] rounded-[50%] bg-black/70 blur-2xl" aria-hidden="true" />
      <div className="relative size-full [transform:perspective(1200px)_rotateX(26deg)] [transform-origin:50%_60%]">
        <svg
          viewBox="0 0 200 200"
          className="size-full drop-shadow-[0_18px_28px_rgba(0,0,0,0.65)]"
          role="img"
          aria-label={phase === 'spinning' ? 'Roulette wheel, spinning' : landed !== null ? `Roulette wheel showing ${landed} ${pocketColor(landed)}` : 'Roulette wheel'}
        >
          <defs>
            <radialGradient id="rw-wood" cx="50%" cy="45%" r="55%">
              <stop offset="0.80" stopColor="#3b1a07" />
              <stop offset="0.86" stopColor="#8a4515" />
              <stop offset="0.92" stopColor="#c0702a" />
              <stop offset="0.97" stopColor="#7a3810" />
              <stop offset="1" stopColor="#2b1205" />
            </radialGradient>
            <radialGradient id="rw-track" cx="50%" cy="50%" r="50%">
              <stop offset="0.88" stopColor="#060606" />
              <stop offset="0.94" stopColor="#25211d" />
              <stop offset="1" stopColor="#0b0a09" />
            </radialGradient>
            <radialGradient id="rw-cone" cx="46%" cy="40%" r="62%">
              <stop offset="0" stopColor="#e2a35a" />
              <stop offset="0.45" stopColor="#b8722f" />
              <stop offset="0.8" stopColor="#7c4116" />
              <stop offset="1" stopColor="#3c1d08" />
            </radialGradient>
            <linearGradient id="rw-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff1c4" />
              <stop offset="0.35" stopColor="#d9b25e" />
              <stop offset="0.7" stopColor="#8a6a2a" />
              <stop offset="1" stopColor="#e8cf8a" />
            </linearGradient>
            <radialGradient id="rw-turret" cx="40%" cy="35%" r="70%">
              <stop offset="0" stopColor="#fff6d8" />
              <stop offset="0.4" stopColor="#d9b25e" />
              <stop offset="1" stopColor="#5e4513" />
            </radialGradient>
            <radialGradient id="rw-ball" cx="35%" cy="30%" r="70%">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.55" stopColor="#f1ede4" />
              <stop offset="1" stopColor="#a8a296" />
            </radialGradient>
            <radialGradient id="rw-pocket-shade" cx="50%" cy="50%" r="50%">
              <stop offset="0.66" stopColor="#000" stopOpacity="0.55" />
              <stop offset="0.76" stopColor="#000" stopOpacity="0.1" />
              <stop offset="0.82" stopColor="#000" stopOpacity="0.35" />
            </radialGradient>
            <radialGradient id="rw-sheen" cx="35%" cy="22%" r="60%">
              <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.03" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Stationary bowl: wooden rim, polished ebony ball track, brass diamonds. */}
          <circle cx="100" cy="100" r="100" fill="url(#rw-wood)" />
          {Array.from({ length: 5 }, (_, i) => (
            <circle key={i} cx="100" cy="100" r={98.6 - i * 0.55} fill="none" stroke="#2a1205" strokeOpacity={0.18 + (i % 2) * 0.12} strokeWidth="0.25" />
          ))}
          <circle cx="100" cy="100" r="97.4" fill="none" stroke="url(#rw-gold)" strokeWidth="0.9" />
          <circle cx="100" cy="100" r="96.9" fill="url(#rw-track)" />
          {Array.from({ length: 8 }, (_, i) => {
            const a = 22.5 + i * 45;
            const [x, y] = polar(93.6, a);
            return <path key={i} d="M0 -2.6 L1.05 0 L0 2.6 L-1.05 0 Z" fill="url(#rw-gold)" stroke="#5e4513" strokeWidth="0.15" transform={`translate(${x} ${y}) rotate(${a})`} />;
          })}
          <circle cx="100" cy="100" r="90.6" fill="none" stroke="url(#rw-gold)" strokeWidth="0.7" />

          {/* Rotor: number ring, pockets with brass frets, wooden cone, turret. */}
          <g ref={wheel} transform="rotate(0 100 100)">
            {WHEEL_ORDER.map((n, i) => {
              const a0 = i * SECTOR - SECTOR / 2;
              const a1 = a0 + SECTOR;
              const ring = (ro: number, ri: number) => {
                const [x0, y0] = polar(ro, a0);
                const [x1, y1] = polar(ro, a1);
                const [x2, y2] = polar(ri, a1);
                const [x3, y3] = polar(ri, a0);
                return `M${x0} ${y0} A${ro} ${ro} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${ri} ${ri} 0 0 0 ${x3} ${y3}Z`;
              };
              const [tx, ty] = polar(85.6, i * SECTOR);
              return (
                <g key={n}>
                  <path d={ring(90.2, 81.4)} fill={FILL[pocketColor(n)]} />
                  <path d={ring(81.4, 63.5)} fill={POCKET[pocketColor(n)]} />
                  <text x={tx} y={ty} fill="#f6f1e6" fontSize="5.4" fontWeight="700" textAnchor="middle" dominantBaseline="central" transform={`rotate(${i * SECTOR} ${tx} ${ty})`} fontFamily="Inter Variable, sans-serif">
                    {n}
                  </text>
                </g>
              );
            })}
            {/* Pocket shading, then brass frets between pockets. */}
            <circle cx="100" cy="100" r="81.4" fill="url(#rw-pocket-shade)" />
            {WHEEL_ORDER.map((_, i) => {
              const a = i * SECTOR - SECTOR / 2;
              const [x0, y0] = polar(90.2, a);
              const [x1, y1] = polar(63.5, a);
              return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="url(#rw-gold)" strokeWidth="0.55" />;
            })}
            <circle cx="100" cy="100" r="81.4" fill="none" stroke="url(#rw-gold)" strokeWidth="0.6" />
            <circle cx="100" cy="100" r="63.5" fill="url(#rw-cone)" stroke="url(#rw-gold)" strokeWidth="1" />
            {Array.from({ length: 8 }, (_, i) => {
              const [x0, y0] = polar(17, i * 45 + 22.5);
              const [x1, y1] = polar(56, i * 45 + 22.5);
              return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="#f3d48f" strokeOpacity="0.35" strokeWidth="0.5" />;
            })}
            {/* Turret with four arms. */}
            {Array.from({ length: 4 }, (_, i) => {
              const [x, y] = polar(27, i * 90);
              return (
                <g key={i}>
                  <line x1="100" y1="100" x2={x} y2={y} stroke="url(#rw-gold)" strokeWidth="2.6" strokeLinecap="round" />
                  <circle cx={x} cy={y} r="2.4" fill="url(#rw-turret)" stroke="#5e4513" strokeWidth="0.3" />
                </g>
              );
            })}
            <circle cx="100" cy="100" r="11" fill="url(#rw-turret)" stroke="#5e4513" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="5" fill="url(#rw-gold)" />
            <circle cx="98.4" cy="98" r="1.6" fill="#fffbe8" opacity="0.85" />
          </g>

          {/* Light: a soft sheen over the bowl. */}
          <circle cx="100" cy="100" r="99" fill="url(#rw-sheen)" pointerEvents="none" />
          {/* Marker at the top: the winning pocket comes to rest under it. */}
          <path d="M100 6.4 L97.4 0.8 L102.6 0.8 Z" fill="url(#rw-gold)" stroke="#3b2a0a" strokeWidth="0.4" />
          <circle ref={ball} cx="100" cy="34" r="2.9" fill="url(#rw-ball)" stroke="#5b564c" strokeWidth="0.3" visibility="hidden" data-testid="roulette-ball" />
        </svg>
      </div>
    </div>
  );
}
