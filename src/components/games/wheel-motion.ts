/**
 * Geometry and timing of the roulette wheel animation. Pure functions, so
 * the "where does the wheel stop" logic is unit-tested.
 *
 * The wheel never decides anything: `spinTarget` is given the server's
 * result and returns an angle that puts that pocket under the pointer.
 *
 * Convention: pocket i of WHEEL_ORDER is drawn at i·SECTOR degrees clockwise
 * from the top; rotating the wheel by r degrees (clockwise) puts the pocket at
 * index round(−r / SECTOR) under the pointer at the top.
 */
import { WHEEL_ORDER } from '@/engine/games/roulette/rules';

export const SECTOR = 360 / WHEEL_ORDER.length;
/** Idle rotation speed, degrees per second. */
export const IDLE_DEG_PER_SEC = 9;
/** Speed the wheel winds up to once betting closes and a spin is coming. */
export const WINDUP_DEG_PER_SEC = 140;
/** Time constant for speed changes outside a spin, ms. */
export const SPEED_TAU_MS = 600;
/** Length of a real spin, ms. */
export const SPIN_MS = 4200;
/** How long the landed result is held before idle resumes, ms. */
export const REVEAL_HOLD_MS = 3500;
/** Whole wheel turns added to a spin, and ball laps in the other direction. */
export const SPIN_TURNS = 5;
export const BALL_LAPS = 7;

export const mod = (x: number, m: number) => ((x % m) + m) % m;

/** The wheel rotation (0–360) that puts `pocket` under the pointer. */
export function angleForPocket(pocket: number): number {
  const index = WHEEL_ORDER.indexOf(pocket);
  if (index < 0) throw new RangeError(`not a pocket: ${pocket}`);
  return mod(-index * SECTOR, 360);
}

/** The pocket under the pointer for a wheel rotation. */
export function pocketAtAngle(rotation: number): number {
  const index = mod(Math.round(mod(-rotation, 360) / SECTOR), WHEEL_ORDER.length);
  return WHEEL_ORDER[index]!;
}

/** The final rotation of a spin from `current` that lands on `result`, at least `turns` full turns on. */
export function spinTarget(current: number, result: number, turns = SPIN_TURNS): number {
  const base = current + turns * 360;
  return base + mod(angleForPocket(result) - mod(base, 360), 360);
}

/** Decelerating ease (cubic): fast push, slow settle. */
export const easeOutCubic = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

/**
 * Spin progress 0→1 as a cubic Hermite curve that starts with normalised
 * slope `m0` (the wheel's current speed, so idle or wind-up motion flows
 * into the spin without a jump) and ends at rest. Monotonic for 0 ≤ m0 ≤ 3.
 */
export function spinEase(p: number, m0: number): number {
  const t = Math.min(1, Math.max(0, p));
  const m = Math.min(3, Math.max(0, m0));
  return m * (t * t * t - 2 * t * t + t) + (3 * t * t - 2 * t * t * t);
}

/** The normalised start slope for a spin from `from` to `to` begun at `speed` °/s. */
export function spinStartSlope(speed: number, from: number, to: number): number {
  const distance = to - from;
  return distance > 0 ? Math.min(3, Math.max(0, (speed * SPIN_MS) / 1000 / distance)) : 0;
}

/** Eases a speed towards a target over `dt` ms (exponential approach). */
export function approachSpeed(current: number, target: number, dt: number, tau = SPEED_TAU_MS): number {
  return target + (current - target) * Math.exp(-Math.max(0, dt) / tau);
}
/** The ball slows a little faster than the wheel, then rides with it. */
export const easeBall = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 2.4);

export interface SpinFrame {
  /** Wheel rotation, degrees. */
  wheel: number;
  /** Ball position, screen degrees clockwise from the top. */
  ball: number;
  /** Ball distance from the centre, in wheel units (viewBox 200). */
  ballRadius: number;
}

export const BALL_TRACK_R = 93.8;
export const BALL_POCKET_R = 72;

/** The wheel and ball at progress p (0–1) of a spin from `from` to `to`, starting with slope m0. */
export function spinFrame(p: number, from: number, to: number, m0 = 0): SpinFrame {
  const wheel = from + (to - from) * spinEase(p, m0);
  // The ball circles anticlockwise and finishes at the pointer (screen angle 0).
  const ball = -BALL_LAPS * 360 * (1 - easeBall(p));
  // It rides the outer track, then drops into the pockets during the last third.
  const drop = Math.min(1, Math.max(0, (p - 0.55) / 0.3));
  const ballRadius = BALL_TRACK_R - (BALL_TRACK_R - BALL_POCKET_R) * (drop * drop * (3 - 2 * drop));
  return { wheel, ball, ballRadius };
}

/** Index of the pocket the ball is over, relative to the wheel. */
export function pocketIndexUnderBall(wheel: number, ball: number): number {
  return mod(Math.round(mod(ball - wheel, 360) / SECTOR), WHEEL_ORDER.length);
}
