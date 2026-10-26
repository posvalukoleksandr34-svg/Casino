/**
 * Fault-injection points used by integration tests to simulate crashes or
 * database failures in the middle of a transaction. Outside of tests no
 * fault is ever armed, so `maybeFail` is a no-op.
 */
export type FaultPoint = 'round.afterBetPosted' | 'round.beforeSettle' | 'round.afterSettle';

const armed = new Map<FaultPoint, Error>();

export function armFault(point: FaultPoint, error = new Error(`injected fault at ${point}`)): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('fault injection is only available in tests');
  armed.set(point, error);
}

export function clearFaults(): void {
  armed.clear();
}

export function maybeFail(point: FaultPoint): void {
  if (armed.size === 0) return;
  const err = armed.get(point);
  if (err) {
    armed.delete(point);
    throw err;
  }
}
