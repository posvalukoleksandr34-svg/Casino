import { describe, expect, it } from 'vitest';
import { WHEEL_ORDER } from '@/engine/games/roulette/rules';
import {
  angleForPocket,
  approachSpeed,
  BALL_POCKET_R,
  easeOutCubic,
  IDLE_DEG_PER_SEC,
  mod,
  pocketAtAngle,
  pocketIndexUnderBall,
  SECTOR,
  spinEase,
  spinFrame,
  spinStartSlope,
  spinTarget,
  SPIN_MS,
  SPIN_TURNS,
  WINDUP_DEG_PER_SEC,
} from '@/components/games/wheel-motion';

describe('wheel geometry', () => {
  it('maps every pocket to an angle and back', () => {
    for (const n of WHEEL_ORDER) expect(pocketAtAngle(angleForPocket(n))).toBe(n);
    expect(pocketAtAngle(0)).toBe(WHEEL_ORDER[0]);
    // Half a sector either side still reads the same pocket.
    expect(pocketAtAngle(angleForPocket(17) + SECTOR * 0.45)).toBe(17);
  });

  it('rejects a number that is not a pocket', () => {
    expect(() => angleForPocket(37)).toThrow(RangeError);
  });
});

describe('a spin lands on the server result', () => {
  const starts = [0, 12.345, 359.99, -720.5, 98_765.4321];
  it('from any current angle, for every pocket, after at least the configured turns', () => {
    for (const from of starts) {
      for (const n of WHEEL_ORDER) {
        const to = spinTarget(from, n);
        expect(pocketAtAngle(to)).toBe(n);
        expect(to - from).toBeGreaterThanOrEqual(SPIN_TURNS * 360);
        expect(to - from).toBeLessThan((SPIN_TURNS + 1) * 360);
      }
    }
  });

  it('ends with the wheel at the target and the ball in the winning pocket under the pointer', () => {
    for (const [n, m0] of [[0, 0], [17, 0.3], [32, 1], [26, 3]] as const) {
      const from = 123.4;
      const to = spinTarget(from, n);
      const end = spinFrame(1, from, to, m0);
      expect(end.wheel).toBeCloseTo(to, 9);
      expect(mod(end.ball, 360)).toBeCloseTo(0, 9);
      expect(end.ballRadius).toBe(BALL_POCKET_R);
      expect(WHEEL_ORDER[pocketIndexUnderBall(end.wheel, end.ball)]).toBe(n);
    }
  });

  it('moves monotonically forward and starts where idle left the wheel', () => {
    const from = 40;
    const to = spinTarget(from, 5);
    expect(spinFrame(0, from, to).wheel).toBe(from);
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const w = spinFrame(p, from, to).wheel;
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
  });
});

describe('idle, wind-up and the hand-over into a spin', () => {
  it('speed changes ease towards their target without overshoot', () => {
    let v = 0;
    // 600 frames of 16 ms ≈ 9.6 s, i.e. 16 time constants.
    for (let i = 0; i < 600; i++) {
      const next = approachSpeed(v, IDLE_DEG_PER_SEC, 16);
      expect(next).toBeGreaterThanOrEqual(v);
      expect(next).toBeLessThanOrEqual(IDLE_DEG_PER_SEC);
      v = next;
    }
    expect(v).toBeCloseTo(IDLE_DEG_PER_SEC, 2);
    expect(approachSpeed(WINDUP_DEG_PER_SEC, IDLE_DEG_PER_SEC, 1e6)).toBeCloseTo(IDLE_DEG_PER_SEC, 9);
  });

  it('a spin starts at the current wheel speed (no jump) and is monotonic for every start speed', () => {
    const from = 10;
    const to = spinTarget(from, 7);
    for (const speed of [0, IDLE_DEG_PER_SEC, WINDUP_DEG_PER_SEC, 5000]) {
      const m0 = spinStartSlope(speed, from, to);
      expect(m0).toBeGreaterThanOrEqual(0);
      expect(m0).toBeLessThanOrEqual(3);
      // Initial angular speed of the spin (°/s) equals the wind-up speed (unless capped).
      const dp = 1e-6;
      const initial = ((spinFrame(dp, from, to, m0).wheel - from) / (dp * SPIN_MS)) * 1000;
      if (speed <= 3 * ((to - from) / SPIN_MS) * 1000) expect(initial).toBeCloseTo(speed, 0);
      let prev = -Infinity;
      for (let p = 0; p <= 1.0001; p += 0.005) {
        const e = spinEase(p, m0);
        expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = e;
      }
      expect(spinEase(1, m0)).toBeCloseTo(1, 12);
      expect(spinEase(0, m0)).toBe(0);
    }
  });
});
