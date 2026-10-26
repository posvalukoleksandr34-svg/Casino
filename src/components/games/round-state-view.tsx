import { describeBet, pocketColor, type RouletteState } from '@/engine/games/roulette';
import type { DiceState } from '@/engine/games/dice';
import { formatChips } from '@/engine/money';
import { cn } from '@/lib/cn';

/** Read-only rendering of a finished (or open) round's public state. */
export function RoundStateView({ gameId, state, status }: { gameId: string; state: unknown; status: string }) {
  if (status === 'VOIDED') return <p className="text-sm text-ink-300">This round was voided and the full stake returned.</p>;
  switch (gameId) {
    case 'roulette': {
      const s = state as RouletteState;
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'grid size-12 place-items-center rounded-full border border-gold-600 font-display text-2xl',
                pocketColor(s.result) === 'red' ? 'bg-roulette-red' : pocketColor(s.result) === 'green' ? 'bg-roulette-green' : 'bg-roulette-black',
              )}
            >
              {s.result}
            </span>
            <span className="capitalize text-ink-300">{s.color}</span>
          </div>
          <ul className="divide-y divide-ink-800 text-sm">
            {s.results.map((r, i) => (
              <li key={i} className="flex justify-between py-2">
                <span className={r.won ? 'text-positive' : 'text-ink-300'}>
                  {describeBet(r.bet)} · {formatChips(r.bet.amount)}
                </span>
                <span className="num">{r.won ? `+${formatChips(r.payout)}` : 'lost'}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'dice': {
      const s = state as DiceState;
      return (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-ink-500">Roll</dt>
            <dd className={cn('num text-3xl font-light', s.won ? 'text-positive' : 'text-ink-200')}>{(s.roll / 100).toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">Condition</dt>
            <dd className="num text-ink-200">
              Roll {s.direction} {(s.target / 100).toFixed(2)} ({(s.winCount / 100).toFixed(2)}%)
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">Multiplier</dt>
            <dd className="num text-ink-200">{(s.multiplierE4 / 10_000).toFixed(4)}×</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">Result</dt>
            <dd className={s.won ? 'text-positive' : 'text-ink-300'}>{s.won ? 'Win' : 'No win'}</dd>
          </div>
        </dl>
      );
    }
    default:
      return <pre className="overflow-x-auto rounded-lg bg-ink-900 p-3 text-xs text-ink-300">{JSON.stringify(state, null, 2)}</pre>;
  }
}
