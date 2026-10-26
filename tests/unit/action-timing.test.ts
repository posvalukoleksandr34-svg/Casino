import { describe, expect, it } from 'vitest';
import { decideTimedAction, settlementDeadline, settlementDue, TIME_SETTLEMENT_GRACE_MS } from '@/server/games/action-timing';

const end = new Date('2026-01-01T00:00:10.000Z');
const ms = (offset: number) => new Date(end.getTime() + offset);
const G = TIME_SETTLEMENT_GRACE_MS;

describe('timed action ordering rule', () => {
  it('the grace is positive and the deadline is end + grace', () => {
    expect(G).toBeGreaterThan(0);
    expect(settlementDeadline(end).getTime()).toBe(end.getTime() + G);
  });

  it.each([
    // receivedAt, processedAt, decision
    [-1, -1, { kind: 'apply' }],
    [-1, G - 1, { kind: 'apply' }],
    [-5_000, G - 1, { kind: 'apply' }],
    [0, 0, { kind: 'reject_ended' }], // the end instant belongs to the end
    [1, G - 1, { kind: 'reject_ended' }],
    [-1, G, { kind: 'settle_by_time', resolution: 'processing_deadline_passed' }],
    [-5_000, G + 60_000, { kind: 'settle_by_time', resolution: 'processing_deadline_passed' }],
    [0, G, { kind: 'settle_by_time', resolution: 'received_after_end' }],
    [5, G + 1, { kind: 'settle_by_time', resolution: 'received_after_end' }],
  ])('received end%+d ms, processed end%+d ms', (received, processed, decision) => {
    expect(decideTimedAction({ receivedAt: ms(received), processedAt: ms(processed), end })).toEqual(decision);
  });

  it('settlement by time is never due before the deadline, and always from it', () => {
    expect(settlementDue(end, ms(0))).toBe(false);
    expect(settlementDue(end, ms(G - 1))).toBe(false);
    expect(settlementDue(end, ms(G))).toBe(true);
    expect(settlementDue(end, ms(G + 1))).toBe(true);
  });

  it('an action that can apply and a due settlement never coexist at the same clock reading', () => {
    for (let processed = -10; processed <= G + 10; processed += 1) {
      const applies = decideTimedAction({ receivedAt: ms(-1), processedAt: ms(processed), end }).kind === 'apply';
      expect(applies && settlementDue(end, ms(processed))).toBe(false);
    }
  });
});
