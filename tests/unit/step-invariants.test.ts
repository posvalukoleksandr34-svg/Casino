/**
 * Property tests for the contract between interactive game engines and the
 * round service (src/server/games/round-service.ts applyStep):
 *   1. stake grows by exactly the additional wagers of the step;
 *   2. every additional wager declares an outcome-independent payout bound,
 *      and the new worst case never exceeds the previous one plus those bounds;
 *   3. a settled payout never exceeds the declared worst case;
 *   4. amounts are safe integers.
 * Random action sequences are played over many provably fair shoes/boards.
 */
import { describe, expect, it } from 'vitest';
import { allowedActions, blackjack, type BlackjackAction, type BlackjackState } from '@/engine/games/blackjack';
import { crash, type CrashState } from '@/engine/games/crash';
import { mines, type MinesState } from '@/engine/games/mines';
import type { StepResult } from '@/engine/games/types';
import { HmacRandomStream } from '@/engine/rng/provably-fair';
import { SimulationRandom } from '@/engine/rng/sim-random';

const stream = (nonce: number, client: string) => new HmacRandomStream({ serverSeed: 'f'.repeat(64), clientSeed: client, nonce });

function checkStep(prev: StepResult<unknown>, next: StepResult<unknown>) {
  const added = next.additionalStakes.reduce((a, s) => a + s.amount, 0);
  expect(next.risk.stake).toBe(prev.risk.stake + added);
  for (const s of next.additionalStakes) {
    expect(Number.isSafeInteger(s.amount) && s.amount > 0).toBe(true);
    expect(s.maxAddedPayout, `${s.kind} must declare maxAddedPayout`).toBeDefined();
  }
  const bound = prev.risk.maxPayout + next.additionalStakes.reduce((a, s) => a + (s.maxAddedPayout ?? 0), 0);
  if (added > 0) expect(next.risk.maxPayout).toBeLessThanOrEqual(bound);
  expect(Number.isSafeInteger(next.payout) && next.payout >= 0).toBe(true);
  if (next.status === 'SETTLED') expect(next.payout).toBeLessThanOrEqual(next.risk.maxPayout);
}

describe('interactive step invariants', () => {
  it('blackjack: random legal play (insurance, splits, doubles) over 3,000 shoes', () => {
    const choose = new SimulationRandom([11, 22, 33, 44]);
    for (const config of [blackjack.defaultConfig, { ...blackjack.defaultConfig, decks: 8 as const, dealerHitsSoft17: true, blackjackPays: '6:5' as const, doubleAfterSplit: false }]) {
      for (let nonce = 0; nonce < 1_500; nonce += 1) {
        const amount = 1 + choose.nextInt(100_000);
        let step: StepResult<BlackjackState> = blackjack.start(config, { amount }, stream(nonce, 'bj-prop'));
        expect(step.risk.maxPayout).toBeLessThanOrEqual(blackjack.assess(config, { amount }).maxPayout);
        if (step.status === 'SETTLED') expect(step.payout).toBeLessThanOrEqual(step.risk.maxPayout);
        let guard = 0;
        while (step.status === 'OPEN') {
          guard += 1;
          expect(guard).toBeLessThan(100);
          const allowed = allowedActions(config, step.state);
          const pick = allowed[choose.nextInt(allowed.length)]!;
          const action: BlackjackAction = pick === 'insurance' ? { type: 'insurance', take: choose.nextInt(2) === 1 } : { type: pick };
          const next = blackjack.act(config, step.state, action, { elapsedMs: 0 });
          checkStep(step, next);
          step = next;
        }
        // Structural worst case: 4 hands each doubled (16×) plus insurance (1.5×).
        expect(step.payout).toBeLessThanOrEqual(16 * amount + Math.floor(amount / 2) * 3);
      }
    }
  });

  it('mines: random reveal/cash-out sequences over 2,000 boards', () => {
    const choose = new SimulationRandom([5, 6, 7, 8]);
    const config = mines.defaultConfig;
    for (let nonce = 0; nonce < 2_000; nonce += 1) {
      const count = 1 + choose.nextInt(24);
      const amount = 1 + choose.nextInt(100_000);
      const assessed = mines.assess(config, { amount, mines: count });
      let step: StepResult<MinesState> = mines.start(config, { amount, mines: count }, stream(nonce, 'mines-prop'));
      while (step.status === 'OPEN') {
        const s = step.state;
        const hidden = Array.from({ length: 25 }, (_, t) => t).filter((t) => !s.revealed.includes(t));
        const cash = s.revealed.length > 0 && choose.nextInt(4) === 0;
        const next = mines.act(config, s, cash ? { type: 'cashout' } : { type: 'reveal', tile: hidden[choose.nextInt(hidden.length)]! }, { elapsedMs: 0 });
        checkStep(step, next);
        expect(next.risk.maxPayout).toBeLessThanOrEqual(assessed.maxPayout);
        step = next;
      }
    }
  });

  it('crash: manual cash-outs at random times never pay above the worst case', () => {
    const choose = new SimulationRandom([9, 8, 7, 6]);
    const config = crash.defaultConfig;
    for (let nonce = 0; nonce < 3_000; nonce += 1) {
      const amount = 1 + choose.nextInt(100_000);
      const auto = choose.nextInt(2) ? 101 + choose.nextInt(10_000) : undefined;
      const bet = { amount, ...(auto ? { autoCashoutE2: auto } : {}) };
      const start: StepResult<CrashState> = crash.start(config, bet, stream(nonce, 'crash-prop'));
      if (start.status !== 'OPEN') continue;
      const due = crash.expiresAfterMs(config, start.state)!;
      const t = choose.nextInt(due + 2_000);
      const next = crash.act(config, start.state, { type: 'cashout' }, { elapsedMs: t });
      checkStep(start, next);
      expect(next.status).toBe('SETTLED');
      // A cash-out before the end of the flight is strictly below the crash point.
      if (t < due && next.state.status === 'cashed' && next.state.cashedOutE2 !== start.state.autoCashoutE2) {
        expect(next.state.cashedOutE2!).toBeLessThan(start.state.crashE2);
      }
    }
  });
});
