import { describeBet, pocketColor, type RouletteState } from '@/engine/games/roulette';
import type { DiceState } from '@/engine/games/dice';
import type { MinesView } from '@/engine/games/mines';
import type { CrashView } from '@/engine/games/crash';
import { cardLabel, type HiloView } from '@/engine/games/hilo';
import type { KenoState } from '@/engine/games/keno';
import type { LimboState } from '@/engine/games/limbo';
import type { PlinkoState } from '@/engine/games/plinko';
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
            <dt className="text-xs text-ink-400">Roll</dt>
            <dd className={cn('num text-3xl font-light', s.won ? 'text-positive' : 'text-ink-200')}>{(s.roll / 100).toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Condition</dt>
            <dd className="num text-ink-200">
              Roll {s.direction} {(s.target / 100).toFixed(2)} ({(s.winCount / 100).toFixed(2)}%)
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Multiplier</dt>
            <dd className="num text-ink-200">{(s.multiplierE4 / 10_000).toFixed(4)}×</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Result</dt>
            <dd className={s.won ? 'text-positive' : 'text-ink-300'}>{s.won ? 'Win' : 'No win'}</dd>
          </div>
        </dl>
      );
    }
    case 'mines': {
      const s = state as MinesView;
      return (
        <div className="space-y-4">
          <div className="grid w-56 grid-cols-5 gap-1.5">
            {Array.from({ length: 25 }, (_, t) => (
              <div
                key={t}
                className={cn(
                  'grid aspect-square place-items-center rounded-md border text-xs',
                  s.revealed.includes(t) ? 'border-gold-600 bg-gold-800/40 text-gold-200' : s.mines?.includes(t) ? (s.hitMine === t ? 'border-negative bg-negative/25 text-negative' : 'border-ink-600 bg-ink-800 text-ink-400') : 'border-ink-700 bg-ink-900',
                )}
              >
                {s.revealed.includes(t) ? '◆' : s.mines?.includes(t) ? '✹' : ''}
              </div>
            ))}
          </div>
          <p className="text-sm text-ink-300">
            {s.mineCount} mines · {s.revealed.length} safe pick(s) · {s.status === 'busted' ? 'hit a mine' : s.status === 'cashed' ? `cashed out at ${(s.multiplierE4 / 10_000).toFixed(4)}×` : 'in progress'}
          </p>
        </div>
      );
    }
    case 'crash': {
      const s = state as CrashView;
      return (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-ink-400">Crash point</dt>
            <dd className="num text-3xl font-light text-ink-100">{s.crashE2 === null ? 'hidden until the round ends' : `${(s.crashE2 / 100).toFixed(2)}×`}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Your cash-out</dt>
            <dd className={cn('num text-3xl font-light', s.status === 'cashed' ? 'text-positive' : 'text-ink-300')}>{s.cashedOutE2 ? `${(s.cashedOutE2 / 100).toFixed(2)}×` : s.status === 'busted' ? 'busted' : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Automatic target</dt>
            <dd className="num text-ink-200">{s.autoCashoutE2 ? `${(s.autoCashoutE2 / 100).toFixed(2)}×` : 'none'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Ended after</dt>
            <dd className="num text-ink-200">{s.endedAtMs !== null ? `${(s.endedAtMs / 1000).toFixed(2)} s` : '—'}</dd>
          </div>
        </dl>
      );
    }
    case 'limbo': {
      const s = state as LimboState;
      return (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-ink-400">Result</dt>
            <dd className={cn('num text-3xl font-light', s.won ? 'text-positive' : 'text-ink-200')}>{(s.resultE2 / 100).toFixed(2)}×</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Target</dt>
            <dd className="num text-3xl font-light text-ink-200">{(s.targetE2 / 100).toFixed(2)}×</dd>
          </div>
        </dl>
      );
    }
    case 'keno': {
      const s = state as KenoState;
      return (
        <div className="space-y-3 text-sm">
          <div className="grid w-full max-w-sm grid-cols-8 gap-1">
            {Array.from({ length: 40 }, (_, i) => i + 1).map((x) => (
              <div
                key={x}
                className={cn(
                  'num grid aspect-square place-items-center rounded border text-[11px]',
                  s.hits.includes(x) ? 'border-positive bg-positive/25 text-positive' : s.picks.includes(x) ? 'border-gold-600 text-gold-200' : s.drawn.includes(x) ? 'border-ink-400 bg-ink-700 text-ink-100' : 'border-ink-800 text-ink-400',
                )}
              >
                {x}
              </div>
            ))}
          </div>
          <p className="text-ink-300">
            {s.hits.length} of {s.picks.length} picks drawn · {(s.multiplierE2 / 100).toFixed(2)}× · drawn: {s.drawn.join(', ')}
          </p>
        </div>
      );
    }
    case 'plinko': {
      const s = state as PlinkoState;
      return (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-ink-400">Slot</dt>
            <dd className="num text-3xl font-light text-ink-100">
              {s.slot} <span className="text-base text-ink-400">of 0–{s.rows}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Multiplier</dt>
            <dd className="num text-3xl font-light text-ink-100">{(s.multiplierE2 / 100).toFixed(2)}×</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-ink-400">
              Path ({s.rows} rows, {s.risk} risk)
            </dt>
            <dd className="num break-all text-ink-200">{s.path.map((b) => (b ? 'R' : 'L')).join(' ')}</dd>
          </div>
        </dl>
      );
    }
    case 'hilo': {
      const s = state as HiloView;
      return (
        <div className="space-y-3 text-sm">
          <ol className="flex flex-wrap gap-2">
            {s.steps.map((st, i) => (
              <li key={i} className={cn('num rounded border px-2 py-1', st.correct === true ? 'border-positive text-positive' : st.correct === false ? 'border-negative text-negative' : 'border-ink-700 text-ink-300')}>
                {st.via === 'start' ? '' : st.via === 'skip' ? 'skip ' : st.via === 'higher' ? '↑ ' : '↓ '}
                {cardLabel(st.card)}
              </li>
            ))}
          </ol>
          <p className="text-ink-300">
            {s.factors.length} correct · {s.status === 'busted' ? 'wrong guess' : s.status === 'cashed' ? `cashed out at ${(s.multiplierE4 / 10_000).toFixed(4)}×` : 'in progress'}
          </p>
        </div>
      );
    }
    default:
      return <pre className="overflow-x-auto rounded-lg bg-ink-900 p-3 text-xs text-ink-300">{JSON.stringify(state, null, 2)}</pre>;
  }
}
