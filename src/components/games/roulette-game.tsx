'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  describeBet,
  payoutTable,
  pocketColor,
  positionKey,
  type RouletteBet,
  type RouletteConfig,
  type RouletteState,
} from '@/engine/games/roulette';
import { formatChips, MINOR_PER_CHIP } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { FairnessStrip, PendingRecovery, RecentRounds, ResultLine, RoundError } from './round-panels';
import { stakeProblem } from './stake-input';
import { RouletteWheel } from './roulette-wheel';
import { useReducedMotion } from './use-reduced-motion';
import { useRound } from './use-round';

const CHIP_VALUES = [1, 5, 25, 100, 500, 1000].map((c) => c * MINOR_PER_CHIP);
const ROWS = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];
const COLUMN_FOR_ROW = [3, 2, 1] as const;

type Placement = Map<string, RouletteBet>;

function addChip(map: Placement, template: RouletteBet, amount: number): Placement {
  const next = new Map(map);
  const key = positionKey(template);
  const existing = next.get(key);
  next.set(key, { ...template, amount: (existing?.amount ?? 0) + amount } as RouletteBet);
  return next;
}

function chipLabel(minor: number): string {
  const chips = minor / MINOR_PER_CHIP;
  return chips >= 1000 ? `${(chips / 1000).toFixed(chips % 1000 ? 1 : 0)}k` : String(chips);
}

export function RouletteGame({ config, limits, status }: { config: RouletteConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const reduced = useReducedMotion();
  const { round, busy, error, start, pending, retryPending, discardPending, commitBalance } = useRound<RouletteState>('roulette', { deferBalance: true });
  const [chip, setChip] = useState(CHIP_VALUES[1]!);
  const [bets, setBets] = useState<Placement>(new Map());
  const [history, setHistory] = useState<Placement[]>([]);
  const [lastSpin, setLastSpin] = useState<Placement | null>(null);
  const [revealed, setRevealed] = useState(true);

  const list = useMemo(() => [...bets.values()], [bets]);
  const total = list.reduce((a, b) => a + b.amount, 0);
  const table = useMemo(() => (list.length ? payoutTable(list) : new Array(37).fill(0)), [list]);
  const maxPayout = Math.max(0, ...table);
  const covered = table.filter((p) => p > 0).length;

  const problem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : list.length === 0
        ? 'Place a bet on the board'
        : list.length > config.maxPositions
          ? 'Too many positions'
          : (stakeProblem(total, limits.minStake, limits.maxStake, balance) ?? (maxPayout > limits.maxPayoutPerRound ? 'Potential payout above table limit' : null));

  const place = useCallback(
    (template: RouletteBet) => {
      if (busy) return;
      setHistory((h) => [...h.slice(-49), bets]);
      setBets((b) => addChip(b, template, chip));
    },
    [bets, chip, busy],
  );

  const spin = async () => {
    setRevealed(false);
    const res = await start({ bets: list }, `${formatChips(total)} chips on ${list.length} position(s)`);
    if (res) setLastSpin(bets);
    else setRevealed(true);
  };

  const onSettled = useCallback(() => {
    setRevealed(true);
    commitBalance();
  }, [commitBalance]);

  const amountAt = (template: RouletteBet) => bets.get(positionKey(template))?.amount ?? 0;
  const result = round?.state.result ?? null;
  const showResult = revealed && round !== null;

  // A render function rather than a nested component, so cells keep their
  // identity (and keyboard focus) across re-renders.
  const cell = (template: RouletteBet, label: string, style: React.CSSProperties, className: string | undefined, children: React.ReactNode) => {
    const key = positionKey(template);
    const amt = amountAt(template);
    const isWinner = showResult && round && round.state.results.some((r) => positionKey(r.bet) === key && r.won);
    const isHit = showResult && template.type === 'straight' && template.number === result;
    return (
      <button
        key={key}
        type="button"
        style={style}
        onClick={() => place(template)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (amt > 0) {
            setHistory((h) => [...h, bets]);
            setBets((b) => {
              const next = new Map(b);
              next.delete(key);
              return next;
            });
          }
        }}
        disabled={busy}
        aria-label={`${label}${amt ? `, ${formatChips(amt)} chips placed` : ''}`}
        data-position={key}
        className={cn(
          'relative flex items-center justify-center border border-gold-700/40 text-sm font-semibold text-ink-100 transition-[background-color,box-shadow] duration-150 hover:bg-white/5 focus-visible:z-10',
          isHit && 'ring-2 ring-inset ring-gold-300',
          isWinner && 'shadow-[inset_0_0_0_2px_rgb(99_185_143/0.8)]',
          className,
        )}
      >
        {children}
        {amt > 0 && (
          <span className="num absolute bottom-0.5 right-0.5 z-10 grid min-w-5 place-items-center rounded-full border-[1.5px] border-dashed border-gold-200 bg-gold-500 px-1 text-[9px] font-bold leading-4 text-ink-950 shadow">
            {chipLabel(amt)}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="grid items-center gap-6 border-b border-ink-700/70 bg-[radial-gradient(ellipse_at_center,rgb(27_64_51/0.55),transparent_75%)] p-6 md:grid-cols-[minmax(0,300px)_1fr]">
            <RouletteWheel result={result} spinKey={round?.id ?? null} reduced={reduced} onSettled={onSettled} />
            <div className="text-center md:text-left" aria-live="polite">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-400">{busy ? 'Drawing…' : showResult ? 'Result' : round ? 'Spinning' : 'Place your bets'}</div>
              {showResult && result !== null ? (
                <>
                  <div className="mt-2 flex items-center justify-center gap-3 md:justify-start" data-testid="roulette-result">
                    <span
                      className={cn(
                        'grid size-16 place-items-center rounded-full border-2 border-gold-500/60 font-display text-4xl font-semibold text-ink-100',
                        pocketColor(result) === 'red' ? 'bg-roulette-red' : pocketColor(result) === 'green' ? 'bg-roulette-green' : 'bg-roulette-black',
                      )}
                    >
                      {result}
                    </span>
                    <span className="text-lg capitalize text-ink-300">{pocketColor(result)}</span>
                  </div>
                  <ul className="mt-4 space-y-1 text-sm">
                    {round!.state.results.map((r) => (
                      <li key={positionKey(r.bet)} className="flex justify-between gap-4">
                        <span className={r.won ? 'text-positive' : 'text-ink-400'}>
                          {describeBet(r.bet)} · {formatChips(r.bet.amount)}
                        </span>
                        <span className={cn('num', r.won ? 'text-positive' : 'text-ink-500')}>{r.won ? `+${formatChips(r.payout)}` : 'lost'}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-3 max-w-sm text-sm text-ink-400">Select a chip and click the board. Right-click a position to remove it. Zero loses every outside bet.</p>
              )}
            </div>
          </div>

          <div className="overflow-x-auto p-4 sm:p-6">
            <div className="min-w-[640px] rounded-xl bg-felt-800 p-2 shadow-[inset_0_0_40px_rgba(0,0,0,0.45)]" role="group" aria-label="Betting board">
              <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] grid-rows-[repeat(5,2.75rem)]">
                {cell({ type: 'straight', number: 0, amount: 0 }, 'Zero', { gridColumn: 1, gridRow: '1 / span 3' }, 'rounded-l-lg bg-roulette-green/80', '0')}
                {ROWS.flatMap((row, r) => [
                  ...row.map((n, i) =>
                    cell(
                      { type: 'straight', number: n, amount: 0 },
                      `${n} ${pocketColor(n)}`,
                      { gridColumn: i + 2, gridRow: r + 1 },
                      pocketColor(n) === 'red' ? 'bg-roulette-red/85' : 'bg-roulette-black/85',
                      n,
                    ),
                  ),
                  cell(
                    { type: 'column', index: COLUMN_FOR_ROW[r]!, amount: 0 },
                    `Column ${COLUMN_FOR_ROW[r]}, pays 2 to 1`,
                    { gridColumn: 14, gridRow: r + 1 },
                    'text-xs text-gold-200',
                    '2:1',
                  ),
                ])}
                {([1, 2, 3] as const).map((d) =>
                  cell(
                    { type: 'dozen', index: d, amount: 0 },
                    `Dozen ${d}, pays 2 to 1`,
                    { gridColumn: `${2 + (d - 1) * 4} / span 4`, gridRow: 4 },
                    'text-xs uppercase tracking-wider text-gold-200',
                    `${['1st', '2nd', '3rd'][d - 1]} 12`,
                  ),
                )}
                {(
                  [
                    ['low', '1–18'],
                    ['even', 'Even'],
                    ['red', 'Red'],
                    ['black', 'Black'],
                    ['odd', 'Odd'],
                    ['high', '19–36'],
                  ] as const
                ).map(([type, label], k) =>
                  cell(
                    { type, amount: 0 },
                    `${label}, pays 1 to 1`,
                    { gridColumn: `${2 + k * 2} / span 2`, gridRow: 5 },
                    cn('text-xs uppercase tracking-wider', type === 'red' ? 'text-[#ff8a80]' : type === 'black' ? 'text-ink-100' : 'text-gold-200'),
                    label,
                  ),
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Chip value</div>
              <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Chip value">
                {CHIP_VALUES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={chip === v}
                    onClick={() => setChip(v)}
                    className={cn(
                      'num grid aspect-square place-items-center rounded-full border-2 border-dashed text-xs font-bold transition-transform',
                      chip === v ? 'scale-110 border-gold-200 bg-gold-500 text-ink-950 shadow-[var(--shadow-gold)]' : 'border-ink-500 bg-ink-800 text-ink-200 hover:border-gold-600',
                    )}
                  >
                    {chipLabel(v)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              <Button size="sm" variant="subtle" onClick={() => history.length && (setBets(history[history.length - 1]!), setHistory((h) => h.slice(0, -1)))} disabled={busy || history.length === 0}>
                Undo
              </Button>
              <Button size="sm" variant="subtle" onClick={() => (setHistory((h) => [...h, bets]), setBets(new Map()))} disabled={busy || bets.size === 0}>
                Clear
              </Button>
              <Button size="sm" variant="subtle" onClick={() => lastSpin && (setHistory((h) => [...h, bets]), setBets(new Map(lastSpin)))} disabled={busy || !lastSpin}>
                Rebet
              </Button>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => (setHistory((h) => [...h, bets]), setBets(new Map([...bets].map(([k, b]) => [k, { ...b, amount: b.amount * 2 } as RouletteBet]))))}
                disabled={busy || bets.size === 0}
              >
                2×
              </Button>
            </div>

            <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-400">Total stake</span>
                <span className="num font-semibold text-ink-100" data-testid="roulette-total">
                  {formatChips(total)} chips
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Positions</span>
                <span className="num text-ink-200">
                  {list.length} · covers {covered}/37
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Best-case payout</span>
                <span className="num text-ink-200">{formatChips(maxPayout)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Expected return</span>
                <span className="num text-ink-200">{formatChips(Math.floor((total * 36) / 37))} (97.30%)</span>
              </div>
            </div>

            <Button variant="primary" size="lg" block loading={busy} disabled={Boolean(problem) || !revealed} onClick={spin} data-testid="roulette-spin">
              {problem ?? 'Spin'}
            </Button>
            {round && revealed && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="Inputs used for the latest spin" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent spins" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="roulette" refreshKey={revealed ? round?.id : null} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}
