'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { describeBet, payoutTable, pocketColor, positionKey, type RouletteBet, type RouletteConfig, type RouletteState } from '@/engine/games/roulette';
import { formatChips } from '@/engine/money';
import { outcomeCue } from '@/lib/audio/cues';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { IconButton } from '../ui/icon-button';
import { ChipMinusIcon, RepeatIcon, RotateCcwIcon, TrashIcon } from '../ui/icons';
import { FairnessStrip, PendingRecovery, ResultLine, RoundError } from './round-panels';
import {
  boardFromBets,
  boardTotal,
  CHIP_DENOMINATIONS,
  doubleBoard,
  EMPTY_BOARD,
  placeChip,
  positionTotal,
  pushUndo,
  removeTopChip,
  toBets,
  type Board,
} from './roulette-board';
import { ChipFace, ChipStack, describeChips, shortChips } from './roulette-chips';
import { HistoryDrawer, HistoryStatsPanel, ResultsStrip, useRouletteHistory } from './roulette-history';
import { RouletteWheel } from './roulette-wheel';
import { stakeProblem } from './stake-input';
import { useGameAudio } from './use-game-audio';
import { useReducedMotion } from './use-reduced-motion';
import { useRound } from './use-round';

const ROWS = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];
const COLUMN_FOR_ROW = [3, 2, 1] as const;

type Limits = { minStake: number; maxStake: number; maxPayoutPerRound: number };

/** Why a board may not be submitted (or null when it may). Mirrors the server's checks for a clear message; the server still decides. */
function boardProblem(board: Board, config: RouletteConfig, limits: Limits, balance: number): string | null {
  const bets = toBets(board);
  if (bets.length === 0) return 'Place a bet on the board';
  if (bets.length > config.maxPositions) return 'Too many positions';
  const maxPayout = Math.max(0, ...payoutTable(bets));
  return stakeProblem(boardTotal(board), limits.minStake, limits.maxStake, balance) ?? (maxPayout > limits.maxPayoutPerRound ? 'Potential payout above table limit' : null);
}

export function RouletteGame({ config, limits, status }: { config: RouletteConfig; limits: Limits; status: string }) {
  const { user, balance } = useSession();
  const reduced = useReducedMotion();
  const audio = useGameAudio('roulette');
  const { round, busy, error, start, pending, retryPending, discardPending, commitBalance } = useRound<RouletteState>('roulette', { deferBalance: true });

  const [chip, setChip] = useState(CHIP_DENOMINATIONS[1].value);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [undo, setUndo] = useState<Board[]>([]);
  const [rebet, setRebet] = useState<Board | null>(null);
  const [removeMode, setRemoveMode] = useState(false);
  /** The round whose result is on screen (set when the wheel has landed). */
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySelected, setHistorySelected] = useState<string | null>(null);

  /** The board as it was sent, for Rebet. */
  const submitted = useRef<Board | null>(null);
  /** Rounds already settled on screen: a repeated callback cannot clear twice. */
  const settledIds = useRef(new Set<string>());
  /** Blocks a second submit before React re-renders. */
  const inFlight = useRef(false);

  const history = useRouletteHistory(Boolean(user), revealedId);

  const bets = useMemo(() => toBets(board), [board]);
  const total = boardTotal(board);
  const table = useMemo(() => (bets.length ? payoutTable(bets) : new Array(37).fill(0)), [bets]);
  const maxPayout = Math.max(0, ...table);
  const covered = table.filter((p) => p > 0).length;

  const spinning = round !== null && round.status === 'SETTLED' && !settledIds.current.has(round.id) && revealedId !== round.id;
  const locked = busy || spinning || pending !== null;
  const showResult = round !== null && revealedId === round.id;
  const result = showResult ? round.state.result : null;

  const problem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : pending
        ? 'Resolve the interrupted spin first'
        : boardProblem(board, config, limits, balance);

  const doubled = useMemo(() => doubleBoard(board), [board]);
  const doubleProblem = board.size === 0 ? 'Place a bet first' : boardProblem(doubled, config, limits, balance);

  const edit = useCallback((next: Board) => {
    setUndo((u) => pushUndo(u, board));
    setBoard(next);
  }, [board]);

  const place = (template: RouletteBet) => {
    if (locked) return;
    const key = positionKey(template);
    if (removeMode) {
      if (!board.has(key)) return;
      edit(removeTopChip(board, key));
      audio.play('chip-remove');
      return;
    }
    edit(placeChip(board, template, chip));
    audio.play('chip-place');
  };

  const removeAt = (key: string) => {
    if (locked || !board.has(key)) return;
    edit(removeTopChip(board, key));
    audio.play('chip-remove');
  };

  const spin = async () => {
    if (inFlight.current || locked || problem) return;
    inFlight.current = true;
    submitted.current = board;
    try {
      // A failed request leaves the board exactly as it was: nothing is cleared
      // until a spin has settled and its animation has finished.
      await start({ bets: toBets(board) }, `${formatChips(total)} chips on ${bets.length} position(s)`);
    } finally {
      inFlight.current = false;
    }
  };

  const onSpinStart = useCallback(() => {
    audio.play('wheel-spin');
    audio.startLoop('ball-roll');
  }, [audio]);
  const onBallDrop = useCallback(() => audio.stopLoop('ball-roll'), [audio]);
  const ticks = useRef(0);
  const onTick = useCallback(() => audio.play('pocket-tick', { rate: 0.94 + (ticks.current++ % 4) * 0.04 }), [audio]);

  /**
   * The wheel has landed on the server's result: apply the deferred balance,
   * show the result, keep the combination for Rebet and clear the table.
   * Runs once per round id however often the wheel reports.
   */
  const onSettled = useCallback(
    (id: string) => {
      if (!round || round.id !== id || settledIds.current.has(id)) return;
      settledIds.current.add(id);
      commitBalance();
      audio.stopLoop('ball-roll');
      const cue = outcomeCue(round.stake, round.payout);
      if (cue) audio.play(cue);
      setRebet(submitted.current ?? boardFromBets(round.state.bets));
      submitted.current = null;
      setBoard(EMPTY_BOARD);
      setUndo([]);
      setRemoveMode(false);
      setRevealedId(id);
    },
    [round, commitBalance, audio],
  );

  const wheelSpin = useMemo(() => (round && round.status === 'SETTLED' ? { id: round.id, result: round.state.result } : null), [round]);

  const openHistory = (id: string | null) => {
    setHistorySelected(id);
    setHistoryOpen(true);
  };

  // A render function rather than a nested component, so cells keep their
  // identity (and keyboard focus) across re-renders.
  const cell = (template: RouletteBet, label: string, style: React.CSSProperties, className: string | undefined, children: React.ReactNode) => {
    const key = positionKey(template);
    const pos = board.get(key);
    const amt = positionTotal(pos);
    const isWinner = showResult && round.state.results.some((r) => positionKey(r.bet) === key && r.won);
    const isHit = showResult && template.type === 'straight' && template.number === result;
    return (
      <button
        key={key}
        type="button"
        style={style}
        onClick={() => place(template)}
        onContextMenu={(e) => {
          e.preventDefault();
          removeAt(key);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            removeAt(key);
          }
        }}
        aria-disabled={locked || undefined}
        aria-label={`${label}${amt ? `, ${formatChips(amt)} chips placed (${describeChips(pos!.chips)})` : ''}${isHit ? ', winning number' : ''}`}
        data-position={key}
        data-amount={amt}
        className={cn(
          'relative flex items-center justify-center border border-gold-700/40 text-sm font-semibold text-ink-100 transition-[background-color,box-shadow] duration-150 focus-visible:z-20',
          locked ? 'cursor-not-allowed' : removeMode ? (amt ? 'cursor-pointer hover:bg-negative/15' : 'cursor-default') : 'hover:bg-white/5',
          isHit && 'ring-2 ring-inset ring-gold-300',
          isWinner && 'shadow-[inset_0_0_0_2px_rgb(99_185_143/0.8)]',
          className,
        )}
      >
        {children}
        {pos && <ChipStack chips={pos.chips} total={amt} className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="grid items-center gap-6 border-b border-ink-700/70 bg-[radial-gradient(ellipse_at_center,rgb(27_64_51/0.55),transparent_75%)] p-6 md:grid-cols-[minmax(0,300px)_1fr]">
            <RouletteWheel spin={wheelSpin} reduced={reduced} onSettled={onSettled} onSpinStart={onSpinStart} onBallDrop={onBallDrop} onTick={onTick} />
            <div className="text-center md:text-left" aria-live="polite">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-400" data-testid="roulette-phase">
                {busy ? 'Drawing…' : spinning ? 'No more bets — spinning' : showResult ? 'Result' : 'Place your bets'}
              </div>
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
                    {round.state.results.map((r) => (
                      <li key={positionKey(r.bet)} className="flex justify-between gap-4">
                        <span className={r.won ? 'text-positive' : 'text-ink-400'}>
                          {describeBet(r.bet)} · {formatChips(r.bet.amount)}
                        </span>
                        <span className={cn('num', r.won ? 'text-positive' : 'text-ink-400')}>{r.won ? `+${formatChips(r.payout)}` : 'lost'}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-ink-400">Bets cleared. Place new chips, or press Rebet to repeat this spin.</p>
                </>
              ) : (
                <p className="mt-3 max-w-sm text-sm text-ink-400">
                  Pick a chip and tap the board. To take a chip off, right-click, press Delete, or use the remove tool. Zero loses every outside bet.
                </p>
              )}
            </div>
          </div>

          <div className="border-b border-ink-700/70 px-4 py-3 sm:px-6">{user ? <ResultsStrip spins={history.spins} onOpen={openHistory} /> : <p className="text-xs text-ink-400">Sign in to see your results history.</p>}</div>

          <div className="overflow-x-auto p-4 sm:p-6">
            <div className={cn('min-w-[640px] rounded-xl bg-felt-800 p-2 shadow-[inset_0_0_40px_rgba(0,0,0,0.45)]', removeMode && 'ring-2 ring-negative/50')} role="group" aria-label={removeMode ? 'Betting board — remove mode: choose a position to take its top chip off' : 'Betting board'}>
              <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] grid-rows-[repeat(5,2.9rem)]">
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
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400" id="roulette-chip-label">
                Chip value
              </div>
              <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-labelledby="roulette-chip-label">
                {CHIP_DENOMINATIONS.map((d) => {
                  const selected = chip === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`${shortChips(d.value)} chip, ${d.color}`}
                      title={`${formatChips(d.value)} chips (${d.color})`}
                      onClick={() => {
                        setChip(d.value);
                        setRemoveMode(false);
                      }}
                      data-chip={d.value}
                      className={cn(
                        'relative grid aspect-square place-items-center rounded-full transition-[transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400',
                        selected ? '-translate-y-1 scale-110 shadow-[0_0_0_2px_var(--color-gold-300),0_8px_18px_-6px_rgb(199_163_91/0.7)]' : 'opacity-85 hover:-translate-y-0.5 hover:opacity-100',
                      )}
                    >
                      <ChipFace value={d.value} className="size-full drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2" role="toolbar" aria-label="Bet tools">
              <div className="flex items-center gap-2">
                <IconButton
                  label="Undo"
                  hint={undo.length ? 'Take back your last change' : 'Nothing to undo'}
                  icon={<RotateCcwIcon />}
                  tooltipAlign="start"
                  disabled={locked || undo.length === 0}
                  onClick={() => {
                    setBoard(undo[undo.length - 1]!);
                    setUndo((u) => u.slice(0, -1));
                    audio.play('chip-remove');
                  }}
                  data-testid="roulette-undo"
                />
                <IconButton
                  label="Clear all bets"
                  hint={board.size ? 'Remove every chip from the table' : 'The table is empty'}
                  icon={<TrashIcon />}
                  disabled={locked || board.size === 0}
                  onClick={() => {
                    edit(EMPTY_BOARD);
                    audio.play('chip-remove');
                  }}
                  data-testid="roulette-clear"
                />
                <IconButton
                  label={removeMode ? 'Stop removing chips' : 'Remove chips'}
                  hint={removeMode ? 'Tap a position to take its top chip off' : 'Then tap a position to take its top chip off'}
                  icon={<ChipMinusIcon />}
                  pressed={removeMode}
                  disabled={locked || (board.size === 0 && !removeMode)}
                  onClick={() => setRemoveMode((m) => !m)}
                  data-testid="roulette-remove-mode"
                />
              </div>
              <div className="flex items-center gap-2">
                <IconButton
                  label="Rebet"
                  text="Rebet"
                  hint={rebet ? `Place last spin's bets again (${formatChips(boardTotal(rebet))} chips)` : 'Available after your first spin'}
                  icon={<RepeatIcon />}
                  disabled={locked || !rebet}
                  onClick={() => {
                    if (!rebet) return;
                    edit(rebet);
                    audio.play('chip-place');
                  }}
                  data-testid="roulette-rebet"
                />
                <IconButton
                  label="Double all bets"
                  text="2×"
                  tooltipAlign="end"
                  hint={doubleProblem ? `Unavailable: ${doubleProblem.toLowerCase()}` : `New total ${formatChips(boardTotal(doubled))} chips`}
                  disabled={locked || doubleProblem !== null}
                  onClick={() => {
                    edit(doubled);
                    audio.play('chip-place');
                  }}
                  data-testid="roulette-double"
                />
              </div>
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
                  {bets.length} · covers {covered}/37
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

            <Button variant="primary" size="lg" block loading={busy} disabled={Boolean(problem) || spinning} onClick={spin} data-testid="roulette-spin">
              {spinning ? 'Spinning…' : (problem ?? 'Spin')}
            </Button>
            {showResult && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="Inputs used for the latest spin" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your statistics" subtitle="Descriptive counts of your past spins" />
          <CardBody className="pt-2">
            {!user ? (
              <p className="text-sm text-ink-400">Sign in to see your history.</p>
            ) : history.spins && history.spins.length > 0 ? (
              <HistoryStatsPanel spins={history.spins.slice(0, 50)} />
            ) : (
              <p className="text-sm text-ink-400">No settled spins yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} selected={historySelected} {...history} />
    </div>
  );
}
