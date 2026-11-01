import { describe, expect, it } from 'vitest';
import { WHEEL_ORDER } from '@/engine/games/roulette/rules';
import {
  angleForPocket,
  BALL_POCKET_R,
  easeOutCubic,
  IDLE_DEG_PER_SEC,
  IDLE_RAMP_MS,
  idleSpeed,
  mod,
  pocketAtAngle,
  pocketIndexUnderBall,
  SECTOR,
  spinFrame,
  spinTarget,
  SPIN_TURNS,
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
    for (const n of [0, 17, 32, 26]) {
      const from = 123.4;
      const to = spinTarget(from, n);
      const end = spinFrame(1, from, to);
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

describe('idle motion', () => {
  it('eases in from rest to its constant decorative speed', () => {
    expect(idleSpeed(0)).toBe(0);
    expect(idleSpeed(IDLE_RAMP_MS / 2)).toBeGreaterThan(0);
    expect(idleSpeed(IDLE_RAMP_MS / 2)).toBeLessThan(IDLE_DEG_PER_SEC);
    expect(idleSpeed(IDLE_RAMP_MS)).toBe(IDLE_DEG_PER_SEC);
    expect(idleSpeed(1e9)).toBe(IDLE_DEG_PER_SEC);
  });
});
