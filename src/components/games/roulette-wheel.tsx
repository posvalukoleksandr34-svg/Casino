'use client';

import { useEffect, useRef, useState } from 'react';
import { pocketColor, WHEEL_ORDER } from '@/engine/games/roulette/rules';
import {
  angleForPocket,
  BALL_POCKET_R,
  idleSpeed,
  IDLE_RAMP_MS,
  mod,
  pocketAtAngle,
  pocketIndexUnderBall,
  REVEAL_HOLD_MS,
  SECTOR,
  SPIN_MS,
  spinFrame,
  spinTarget,
} from './wheel-motion';

const FILL = { red: '#b8322c', black: '#17181c', green: '#1f7a4d' } as const;

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
  resumeAt: number;
  last: number;
  /** Wheel index of the pocket holding the ball, or null (no ball shown). */
  ballIndex: number | null;
  tickIndex: number;
  dropped: boolean;
}

/**
 * The roulette wheel. It turns slowly on its own while players bet (purely
 * decorative: no request, no chips, no result), spins to the authoritative
 * result when it is given one, holds the result, then eases back to idle.
 *
 * Frames are drawn by mutating SVG attributes from requestAnimationFrame, so
 * React does not re-render per frame. With reduced motion there is no idle
 * motion and a result is shown at once.
 */
export function RouletteWheel({
  spin,
  reduced,
  onSettled,
  onSpinStart,
  onBallDrop,
  onTick,
}: {
  spin: WheelSpin | null;
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
  const motion = useRef<Motion>({ mode: 'idle', rotation: 0, from: 0, to: 0, spinStart: 0, landedAt: 0, resumeAt: -IDLE_RAMP_MS, last: 0, ballIndex: null, tickIndex: -1, dropped: false });
  const callbacks = useRef({ onSettled, onSpinStart, onBallDrop, onTick });
  callbacks.current = { onSettled, onSpinStart, onBallDrop, onTick };
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

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
      m.rotation += (idleSpeed(now - m.resumeAt) * dt) / 1000;
      draw();
    } else if (m.mode === 'spinning') {
      const p = (now - m.spinStart) / SPIN_MS;
      if (p >= 1) land(now);
      else {
        const f = spinFrame(p, m.from, m.to);
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
      m.resumeAt = now;
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
    <div ref={root} className="relative mx-auto aspect-square w-full max-w-[340px]" data-testid="roulette-wheel" data-state={phase} data-landed={landed ?? undefined}>
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgb(199_163_91/0.18),transparent_70%)] blur-2xl" aria-hidden="true" />
      <svg
        viewBox="0 0 200 200"
        className="relative size-full drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]"
        role="img"
        aria-label={phase === 'spinning' ? 'Roulette wheel, spinning' : landed !== null ? `Roulette wheel showing ${landed} ${pocketColor(landed)}` : 'Roulette wheel'}
      >
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
          <radialGradient id="rw-ball" cx="35%" cy="30%" r="70%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#ebe8e2" />
            <stop offset="1" stopColor="#9a968e" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="99" fill="url(#rw-rim)" />
        <circle cx="100" cy="100" r="96.5" fill="none" stroke="#0a0b0d" strokeOpacity="0.55" strokeWidth="5" />
        <g ref={wheel} transform="rotate(0 100 100)">
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
        <circle ref={ball} cx="100" cy="34" r="3.3" fill="url(#rw-ball)" stroke="#0a0b0d" strokeWidth="0.5" visibility="hidden" data-testid="roulette-ball" />
      </svg>
    </div>
  );
}
