'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  coverageCounts,
  coveredNumbers,
  doubleBoard,
  EMPTY_BOARD,
  placeChip,
  positionTotal,
  pushUndo,
  removedTops,
  removeTopChip,
  toBets,
  type Board,
} from './roulette-board';
import { ChipFace, ChipGhost, ChipStack, describeChips, shortChips } from './roulette-chips';
import { bettingOpen } from './roulette-cycle';
import { HistoryDrawer, HistoryStatsPanel, ResultsStrip, useRouletteHistory } from './roulette-history';
import { RouletteStatus } from './roulette-status';
import { RouletteWheel } from './roulette-wheel';
import { stakeProblem } from './stake-input';
import { useGameAudio } from './use-game-audio';
import { useReducedMotion } from './use-reduced-motion';
import { cycleNow, useRouletteCycle } from './use-roulette-cycle';
import { useRound } from './use-round';

const ROWS = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];
const COLUMN_FOR_ROW = [3, 2, 1] as const;
const CENTER = 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2';

type Limits = { minStake: number; maxStake: number; maxPayoutPerRound: number };

/** Why a board may not be submitted (or null when it may). Mirrors the server's checks for a clear message; the server still decides. */
function boardProblem(board: Board, config: RouletteConfig, limits: Limits, balance: number): string | null {
  const bets = toBets(board);
  if (bets.length === 0) return 'Place a bet on the board';
  if (bets.length > config.maxPositions) return 'Too many positions';
  const maxPayout = Math.max(0, ...payoutTable(bets));
  return stakeProblem(boardTotal(board), limits.minStake, limits.maxStake, balance) ?? (maxPayout > limits.maxPayoutPerRound ? 'Potential payout above table limit' : null);
}

/**
 * Automatic European roulette table. Betting opens for BETTING_SECONDS; when
 * it closes, the player's own valid bets (if any) are sent once through the
 * existing round API, the wheel spins to the server's result, the result is
 * shown and the table clears, and the next window opens. No bets → no round.
 * See roulette-cycle.ts for the state machine.
 */
export function RouletteGame({ config, limits, status }: { config: RouletteConfig; limits: Limits; status: string }) {
  const { user, balance, refresh } = useSession();
  const reduced = useReducedMotion();
  const audio = useGameAudio('roulette');
  const { round, busy, error, start, pending, retryPending, discardPending, commitBalance } = useRound<RouletteState>('roulette', { deferBalance: true });

  const [chip, setChip] = useState(CHIP_DENOMINATIONS[1].value);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [undo, setUndo] = useState<Board[]>([]);
  const [rebet, setRebet] = useState<Board | null>(null);
  const [removeMode, setRemoveMode] = useState(false);
  /** Bets kept after a refused or discarded request: not sent again until the player changes or confirms them. */
  const [held, setHeld] = useState<string | null>(null);
  /** The round whose result is on screen (set when the wheel has landed). */
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<RouletteBet | null>(null);
  const [ghosts, setGhosts] = useState<{ id: number; key: string; value: number }[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySelected, setHistorySelected] = useState<string | null>(null);

  /** The board as it was sent, for Rebet. */
  const submitted = useRef<Board | null>(null);
  /** Betting windows whose wager was already sent: a repeated effect cannot send twice. */
  const sentWindow = useRef(0);
  /** Rounds already settled on screen: a repeated callback cannot clear twice. */
  const settledIds = useRef(new Set<string>());

  const problem = !user ? 'Sign in to play' : status !== 'ACTIVE' ? 'Game paused' : boardProblem(board, config, limits, balance);
  const canWager = Boolean(user) && status === 'ACTIVE' && pending === null && held === null && board.size > 0 && problem === null;
  const [cycle, dispatch] = useRouletteCycle(canWager);
  const open = cycle !== null && bettingOpen(cycle) && pending === null;
  const locked = !open;

  const history = useRouletteHistory(Boolean(user), revealedId);

  const bets = useMemo(() => toBets(board), [board]);
  const total = boardTotal(board);
  const table = useMemo(() => (bets.length ? payoutTable(bets) : new Array(37).fill(0)), [bets]);
  const maxPayout = Math.max(0, ...table);
  const coverage = useMemo(() => coverageCounts(board), [board]);
  const covered = coverage.filter((c) => c > 0).length;
  const previewKey = preview ? positionKey(preview) : null;
  const previewSet = useMemo(() => new Set(preview ? coveredNumbers(preview) : []), [preview]);

  const showResult = round !== null && revealedId === round.id;
  const result = showResult ? round.state.result : null;
  const inReveal = cycle?.phase === 'RESULT_REVEAL';

  const doubled = useMemo(() => doubleBoard(board), [board]);
  const doubleProblem = board.size === 0 ? 'Place a bet first' : boardProblem(doubled, config, limits, balance);

  // ── Chip animations: chips that leave the table lift off briefly.
  const prevBoard = useRef(board);
  const ghostId = useRef(0);
  useEffect(() => {
    const gone = removedTops(prevBoard.current, board);
    prevBoard.current = board;
    if (reduced || gone.length === 0) return;
    const added = gone.map((g) => ({ ...g, id: ++ghostId.current }));
    setGhosts((gs) => [...gs, ...added]);
    const t = setTimeout(() => setGhosts((gs) => gs.filter((g) => !added.includes(g))), 280);
    return () => clearTimeout(t);
  }, [board, reduced]);

  // ── Editing (only while betting is open).
  const edit = (next: Board) => {
    setUndo((u) => pushUndo(u, board));
    setBoard(next);
    setHeld(null);
  };

  const removeAt = (key: string) => {
    if (locked || !board.has(key)) return;
    edit(removeTopChip(board, key));
    audio.play('chip-remove');
  };

  // Touch: the first tap on a position previews its coverage; a second tap places a chip.
  const lastPointer = useRef<string | null>(null);
  const touchArmed = useRef<string | null>(null);
  const place = (template: RouletteBet) => {
    const key = positionKey(template);
    const pointer = lastPointer.current;
    lastPointer.current = null;
    if (pointer === 'touch' && !removeMode && touchArmed.current !== key) {
      touchArmed.current = key;
      setPreview(template);
      return;
    }
    if (locked) return;
    if (removeMode) {
      removeAt(key);
      return;
    }
    edit(placeChip(board, template, chip));
    audio.play('chip-place');
  };

  // Clear a touch preview when tapping anywhere outside the table.
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boardRef.current && !boardRef.current.contains(e.target as Node)) {
        touchArmed.current = null;
        setPreview(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  // ── The cycle's side effects.

  // Betting closed on a valid board: send it once for this window.
  useEffect(() => {
    if (!cycle || cycle.phase !== 'BETTING_CLOSED' || !cycle.wager || sentWindow.current === cycle.window) return;
    sentWindow.current = cycle.window;
    setRemoveMode(false);
    // Re-check at the moment of sending; nothing is sent if the board changed or became invalid.
    if (board.size === 0 || problem !== null || held !== null || pending !== null) {
      dispatch({ type: 'WAGER_SKIPPED', now: cycleNow() });
      return;
    }
    submitted.current = board;
    audio.play('no-more-bets');
    void start({ bets: toBets(board) }, `${formatChips(total)} chips on ${bets.length} position(s)`).then((res) =>
      dispatch(res ? { type: 'ROUND_RECEIVED', roundId: res.round.id } : { type: 'REQUEST_FAILED' }),
    );
    // Keyed on the window only: the board is frozen while betting is closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.phase, cycle?.window, cycle?.wager]);

  // An interrupted request (now, or from before a reload) puts the table into recovery.
  useEffect(() => {
    if (pending && cycle && (cycle.phase === 'BETTING_OPEN' || (cycle.phase === 'BETTING_CLOSED' && !cycle.wager))) dispatch({ type: 'RECOVERY_NEEDED' });
  }, [pending, cycle, dispatch]);

  // Recovery ends when no request is outstanding: a definitive refusal keeps the bets (held), then betting reopens.
  useEffect(() => {
    if (cycle?.phase !== 'RECOVERY' || pending !== null || busy) return;
    if (error && error.code !== 'NETWORK_ERROR') setHeld(error.message);
    dispatch({ type: 'RECOVERY_RESOLVED', now: cycleNow() });
  }, [cycle?.phase, pending, busy, error, dispatch]);

  const retry = async () => {
    const res = await retryPending();
    if (res) dispatch({ type: 'ROUND_RECEIVED', roundId: res.round.id });
  };
  const discard = () => {
    discardPending();
    setHeld('The interrupted spin was discarded. Check your balance and history before betting these chips again.');
    void refresh();
  };

  // ── Wheel and result.
  const onSpinStart = useCallback(() => {
    audio.play('wheel-spin');
    audio.startLoop('ball-roll');
  }, [audio]);
  const onBallDrop = useCallback(() => audio.stopLoop('ball-roll'), [audio]);
  const ticks = useRef(0);
  const onTick = useCallback(() => audio.play('pocket-tick', { rate: 0.94 + (ticks.current++ % 4) * 0.04 }), [audio]);
  const onWarn = useCallback(() => audio.play('countdown'), [audio]);

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
      setHeld(null);
      setRemoveMode(false);
      setRevealedId(id);
      dispatch({ type: 'LANDED', roundId: id, now: cycleNow() });
    },
    [round, commitBalance, audio, dispatch],
  );

  const wheelSpin = useMemo(() => (round && cycle?.roundId === round.id && round.status === 'SETTLED' ? { id: round.id, result: round.state.result } : null), [round, cycle?.roundId]);
  const windup = cycle?.phase === 'BETTING_CLOSED' && cycle.wager;

  const openHistory = (id: string | null) => {
    setHistorySelected(id);
    setHistoryOpen(true);
  };

  const closedNote = cycle?.phase === 'BETTING_CLOSED' && !cycle.wager && board.size > 0 ? `Bets not placed: ${held ?? problem ?? 'not accepted'}` : null;

  // A render function rather than a nested component, so cells keep their
  // identity (and keyboard focus) across re-renders.
  const cell = (template: RouletteBet, label: string, style: React.CSSProperties, className: string | undefined, children: React.ReactNode) => {
    const key = positionKey(template);
    const pos = board.get(key);
    const amt = positionTotal(pos);
    const straight = template.type === 'straight' ? template.number : null;
    const outcome = showResult ? round.state.results.find((r) => positionKey(r.bet) === key) : undefined;
    const isHit = showResult && straight === result;
    const isPreviewed = previewKey === key;
    const inPreview = straight !== null && previewSet.has(straight);
    const dimmed = preview !== null && straight !== null && !inPreview;
    const cover = straight !== null ? coverage[straight]! : 0;
    const coverLabel = cover > 0 ? `, covered by ${cover} of your bet${cover === 1 ? '' : 's'}` : '';
    return (
      <button
        key={key}
        type="button"
        style={style}
        onPointerDown={(e) => (lastPointer.current = e.pointerType)}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setPreview(template)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setPreview((p) => (p && positionKey(p) === key ? null : p))}
        onFocus={() => setPreview(template)}
        onBlur={() => setPreview((p) => (p && positionKey(p) === key ? null : p))}
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
        aria-label={`${label}${amt ? `, ${formatChips(amt)} chips placed (${describeChips(pos!.chips)})` : ''}${coverLabel}${isHit ? ', winning number' : ''}`}
        data-position={key}
        data-amount={amt}
        data-covered={preview ? (straight === null ? undefined : String(inPreview)) : undefined}
        data-previewed={isPreviewed || undefined}
        data-coverage={cover || undefined}
        className={cn(
          'relative flex items-center justify-center border border-gold-700/40 text-sm font-semibold text-ink-100 transition-[background-color,box-shadow,filter] duration-200 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gold-200',
          locked ? 'cursor-not-allowed' : removeMode ? (amt ? 'cursor-pointer hover:bg-negative/15' : 'cursor-default') : 'hover:bg-white/5',
          inPreview && 'z-10 shadow-[inset_0_0_0_2px_rgb(243_230_194/0.95),0_0_16px_rgb(232_210_155/0.55)] brightness-125',
          isPreviewed && straight === null && 'z-10 bg-gold-500/20 shadow-[inset_0_0_0_2px_rgb(232_210_155/0.9)]',
          isHit && 'ring-2 ring-inset ring-gold-300',
          inReveal && outcome?.won && 'shadow-[inset_0_0_0_2px_rgb(99_185_143/0.85)]',
          inReveal && outcome && !outcome.won && 'shadow-[inset_0_0_0_2px_rgb(224_106_98/0.55)]',
          className,
        )}
      >
        {/* Numbers outside the previewed bet are shaded (under the chips, which stay fully visible). */}
        <span className={cn('pointer-events-none absolute inset-0 bg-ink-950 transition-opacity duration-200', dimmed ? 'opacity-60' : 'opacity-0')} aria-hidden="true" />
        <span className="relative">{children}</span>
        {cover > 0 && (
          <span className="pointer-events-none absolute left-1 top-1 flex gap-0.5" aria-hidden="true" data-coverage-dots={cover}>
            {Array.from({ length: Math.min(cover, 3) }, (_, i) => (
              <span key={i} className="size-1 rounded-full bg-gold-300 shadow-[0_0_3px_rgb(232_210_155/0.9)]" />
            ))}
            {cover > 3 && <span className="text-[8px] font-bold leading-none text-gold-200">+</span>}
          </span>
        )}
        {pos && <ChipStack chips={pos.chips} total={amt} className={CENTER} animate={!reduced} />}
        {ghosts
          .filter((g) => g.key === key)
          .map((g) => (
            <ChipGhost key={g.id} value={g.value} className={CENTER} />
          ))}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <div className="grid items-center gap-6 border-b border-ink-700/70 bg-[radial-gradient(ellipse_at_center,rgb(27_64_51/0.55),transparent_75%)] p-6 md:grid-cols-[minmax(0,300px)_1fr]">
            <RouletteWheel spin={wheelSpin} windup={windup} reduced={reduced} onSettled={onSettled} onSpinStart={onSpinStart} onBallDrop={onBallDrop} onTick={onTick} />
            <div className="text-center md:text-left">
              {showResult && result !== null ? (
                <div className={cn('transition-opacity duration-300', !inReveal && 'opacity-80')}>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-400">{inReveal ? 'Result' : 'Last result'}</div>
                  <div className="mt-2 flex items-center justify-center gap-3 md:justify-start" data-testid="roulette-result" data-result={result}>
                    <span
                      className={cn(
                        'grid size-16 place-items-center rounded-full border-2 border-gold-500/60 font-display text-4xl font-semibold text-ink-100',
                        pocketColor(result) === 'red' ? 'bg-roulette-red' : pocketColor(result) === 'green' ? 'bg-roulette-green' : 'bg-roulette-black',
                        inReveal && !reduced && 'animate-rise shadow-[0_0_28px_rgb(232_210_155/0.45)]',
                      )}
                    >
                      {result}
                    </span>
                    <span className="text-lg capitalize text-ink-300">{pocketColor(result)}</span>
                  </div>
                  <ul className="mt-4 space-y-1 text-sm" aria-label="Your bets in this spin">
                    {round.state.results.map((r) => (
                      <li key={positionKey(r.bet)} className="flex justify-between gap-4">
                        <span className={r.won ? 'text-positive' : 'text-ink-400'}>
                          {describeBet(r.bet)} · {formatChips(r.bet.amount)}
                        </span>
                        <span className={cn('num', r.won ? 'text-positive' : 'text-ink-400')}>{r.won ? `+${formatChips(r.payout)}` : 'lost'}</span>
                      </li>
                    ))}
                  </ul>
                  {round.payout !== null && (
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs" data-testid="roulette-settlement">
                      <div>
                        <dt className="text-ink-400">Stake</dt>
                        <dd className="num text-ink-100">{formatChips(round.stake)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">Payout</dt>
                        <dd className="num text-ink-100">{formatChips(round.payout)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-400">Net</dt>
                        <dd className={cn('num font-semibold', round.payout > round.stake ? 'text-positive' : 'text-ink-100')}>{formatChips(round.payout - round.stake, { sign: true })}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              ) : (
                <div>
                  <div className="font-display text-2xl font-semibold text-ink-100">An automatic table</div>
                  <p className="mt-2 max-w-sm text-sm text-ink-400">
                    Betting opens every round for a few seconds. Your chips go in when time runs out; with no chips on the table, nothing is wagered. Hover, focus or tap a position to see the numbers it covers.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 border-b border-ink-700/70 px-4 py-3 sm:px-6">
            <RouletteStatus cycle={cycle} hasBets={board.size > 0} wagerPending={busy} onWarn={onWarn} note={closedNote} />
            {user ? <ResultsStrip spins={history.spins} onOpen={openHistory} /> : <p className="text-xs text-ink-400">Sign in to see your results history.</p>}
          </div>

          <div className="overflow-x-auto p-4 sm:p-6">
            <div
              ref={boardRef}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setPreview(null)}
              className={cn('min-w-[640px] rounded-xl bg-felt-800 p-2 shadow-[inset_0_0_40px_rgba(0,0,0,0.45)] transition-[filter] duration-300', removeMode && 'ring-2 ring-negative/50', locked && 'saturate-[0.85]')}
              role="group"
              aria-label={removeMode ? 'Betting board — remove mode: choose a position to take its top chip off' : locked ? 'Betting board (betting closed)' : 'Betting board'}
              aria-describedby="roulette-board-help"
              data-testid="roulette-board"
              data-locked={locked}
            >
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
            <p id="roulette-board-help" className="mt-2 text-xs text-ink-400">
              Gold dots mark numbers your bets cover (one dot per bet). On a touch screen, tap once to preview a position and again to place a chip. Remove chips with the remove tool, a right-click or Delete.
            </p>
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
                      data-color={d.color}
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
                  hint={locked ? 'Betting is closed' : undo.length ? 'Take back your last change' : 'Nothing to undo'}
                  icon={<RotateCcwIcon />}
                  tooltipAlign="start"
                  disabled={locked || undo.length === 0}
                  onClick={() => {
                    setBoard(undo[undo.length - 1]!);
                    setUndo((u) => u.slice(0, -1));
                    setHeld(null);
                    audio.play('chip-remove');
                  }}
                  data-testid="roulette-undo"
                />
                <IconButton
                  label="Clear all bets"
                  hint={locked ? 'Betting is closed' : board.size ? 'Remove every chip from the table' : 'The table is empty'}
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
                  hint={locked ? 'Betting is closed' : removeMode ? 'Tap a position to take its top chip off' : 'Then tap a position to take its top chip off'}
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
                  hint={locked ? 'Betting is closed' : rebet ? `Place last spin's bets again (${formatChips(boardTotal(rebet))} chips)` : 'Available after your first spin'}
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
                  hint={locked ? 'Betting is closed' : doubleProblem ? `Unavailable: ${doubleProblem.toLowerCase()}` : `New total ${formatChips(boardTotal(doubled))} chips`}
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
                <span className="text-ink-400">Balance</span>
                <span className="num text-ink-100" data-testid="roulette-balance">
                  {user ? `${formatChips(balance)} chips` : '—'}
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

            <div className="rounded-xl border border-ink-700 bg-ink-850/60 p-3 text-sm" data-testid="roulette-bet-state" aria-live="polite">
              {held ? (
                <div className="space-y-2">
                  <p className="text-warning">Your bets were not sent: {held}</p>
                  <p className="text-xs text-ink-400">They stay on the table. Change them, or confirm them for the next round.</p>
                  <Button size="sm" variant="secondary" disabled={locked} onClick={() => setHeld(null)} data-testid="roulette-unhold">
                    Use these bets next round
                  </Button>
                </div>
              ) : board.size > 0 && problem ? (
                <p className="text-warning">These bets cannot be placed: {problem}.</p>
              ) : board.size > 0 ? (
                <p className="text-ink-200">{open ? 'Ready: these bets go in when the countdown ends.' : 'Bets locked for this round.'}</p>
              ) : (
                <p className="text-ink-400">{problem === 'Sign in to play' || problem === 'Game paused' ? problem : 'No bets on the table — nothing will be wagered.'}</p>
              )}
            </div>
            {showResult && inReveal && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retry} onDiscard={discard} busy={busy} />
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
