'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DICE_OUTCOMES, multiplierE4For, winCountFor, type DiceConfig, type DiceState } from '@/engine/games/dice';
import { formatChips, mulDivFloor } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { FairnessStrip, PendingRecovery, RecentRounds, ResultLine, RoundError } from './round-panels';
import { StakeInput, stakeProblem } from './stake-input';
import { useReducedMotion } from './use-reduced-motion';
import { useRound } from './use-round';
import { useGameAudio } from './use-game-audio';

interface Props {
  config: DiceConfig;
  limits: { minStake: number; maxStake: number; maxPayoutPerRound: number };
  status: string;
}

const PROFILES = [
  { label: 'Steady', chance: 7500 },
  { label: 'Even', chance: 4950 },
  { label: 'Bold', chance: 2000 },
  { label: 'Long shot', chance: 500 },
];

export function DiceGame({ config, limits, status }: Props) {
  const { user, balance } = useSession();
  const reduced = useReducedMotion();
  const { round, busy, error, start, pending, retryPending, discardPending, commitBalance } = useRound<DiceState>('dice', { deferBalance: true });
  const audio = useGameAudio('dice');
  const [stake, setStake] = useState(100 * 10);
  const [direction, setDirection] = useState<'under' | 'over'>('under');
  const [target, setTarget] = useState(4950);
  const [display, setDisplay] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(true);
  const animRef = useRef<number | null>(null);

  const winCount = winCountFor(target, direction);
  const valid = winCount >= config.minWinCount && winCount <= config.maxWinCount;
  const multE4 = valid ? multiplierE4For(winCount, config.houseEdgeBp) : 0;
  const payoutOnWin = valid && stake > 0 ? mulDivFloor(stake, multE4, 10_000) : 0;
  const rtp = (winCount / DICE_OUTCOMES) * (multE4 / 10_000);
  const [minTarget, maxTarget] = direction === 'under' ? [config.minWinCount, config.maxWinCount] : [DICE_OUTCOMES - 1 - config.maxWinCount, DICE_OUTCOMES - 1 - config.minWinCount];

  const problem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : !valid
        ? 'Win chance out of range'
        : (stakeProblem(stake, limits.minStake, limits.maxStake, balance) ?? (payoutOnWin > limits.maxPayoutPerRound ? 'Potential payout above table limit' : null));

  const setChance = (wc: number) => setTarget(direction === 'under' ? wc : DICE_OUTCOMES - 1 - wc);
  const flip = () => {
    setDirection((d) => (d === 'under' ? 'over' : 'under'));
    setTarget((t) => DICE_OUTCOMES - 1 - t);
  };

  // Presentational count-up once the authoritative result has arrived.
  useEffect(() => {
    if (!round) return;
    const final = round.state.roll;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const land = () => {
      audio.play('land');
      audio.play(round.state.won ? 'win' : 'result');
    };
    if (reduced) {
      setDisplay(final);
      setRevealed(true);
      commitBalance();
      land();
      return;
    }
    setRevealed(false);
    audio.play('roll');
    const from = display ?? 5000;
    const t0 = performance.now();
    const dur = 650;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(from + (final - from) * eased));
      if (p < 1) animRef.current = requestAnimationFrame(step);
      else {
        setRevealed(true);
        commitBalance();
        land();
      }
    };
    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  const last = round?.state;
  const showOutcome = Boolean(last && revealed);
  const zoneStart = direction === 'under' ? 0 : ((target + 1) / DICE_OUTCOMES) * 100;
  const zoneWidth = (winCount / DICE_OUTCOMES) * 100;

  const description = useMemo(
    () => `${formatChips(stake)} chips, roll ${direction} ${(target / 100).toFixed(2)}`,
    [stake, direction, target],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="flex flex-col justify-center overflow-hidden bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgb(90_140_255/0.2),transparent_70%),linear-gradient(180deg,rgb(11_20_48/0.85),rgb(6_10_24/0.9))]">
          <div className="relative px-6 pb-8 pt-10 sm:px-10">
            <div className="relative text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-300">{last ? 'Roll' : 'Ready'}</div>
              <div
                className={cn(
                  'mx-auto mt-3 inline-flex min-w-[15rem] items-center justify-center rounded-[1.75rem] border px-8 py-4 backdrop-blur-md transition-[border-color,box-shadow,background-color] duration-300',
                  !showOutcome
                    ? 'border-white/12 bg-white/[0.05] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'
                    : last!.won
                      ? 'border-positive/60 bg-positive/10 shadow-[0_0_40px_-8px_rgb(99_185_143/0.7),inset_0_1px_0_rgb(255_255_255/0.1)]'
                      : 'border-white/12 bg-white/[0.04] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]',
                )}
              >
                <div
                  data-testid="dice-roll"
                  className={cn('num text-7xl font-light tracking-tight transition-colors duration-300 sm:text-8xl', !showOutcome ? 'text-ink-100' : last!.won ? 'text-positive' : 'text-ink-300')}
                  aria-live="polite"
                >
                  {display === null ? '—' : (display / 100).toFixed(2)}
                </div>
              </div>
              <div className="mt-4 h-5 text-sm text-ink-400">
                {showOutcome && (last!.won ? `Win — needed ${last!.direction} ${(last!.target / 100).toFixed(2)}` : `No win — needed ${last!.direction} ${(last!.target / 100).toFixed(2)}`)}
              </div>
            </div>

            <div className="relative mt-10">
              <div className="relative h-4 overflow-hidden rounded-full border border-white/10 bg-[#5a2226]/70 shadow-[inset_0_2px_4px_rgb(0_0_0/0.5)]">
                <div className="absolute inset-y-0 bg-gradient-to-r from-[#2f9e74] to-[#63b98f] shadow-[0_0_14px_rgb(99_185_143/0.5)] transition-all duration-300" style={{ left: `${zoneStart}%`, width: `${zoneWidth}%` }} />
              </div>
              <div className="absolute -top-2 h-8 w-0.5 rounded bg-ink-100 transition-all duration-300" style={{ left: `${(target / DICE_OUTCOMES) * 100}%` }} aria-hidden="true" />
              {display !== null && (
                <div
                  className={cn(
                    'absolute -top-3.5 grid size-10 -translate-x-1/2 place-items-center rounded-xl border bg-[radial-gradient(circle_at_35%_30%,#ffffff,#e6e1d6_60%,#a9a395)] shadow-[0_8px_16px_-6px_rgb(0_0_0/0.8)]',
                    showOutcome && last?.won ? 'border-positive ring-2 ring-positive/60' : 'border-white/70',
                  )}
                  style={{ left: `${(display / DICE_OUTCOMES) * 100}%` }}
                  aria-hidden="true"
                >
                  <span className="grid grid-cols-2 gap-1">
                    {[0, 1, 2, 3].map((k) => (
                      <span key={k} className="size-1.5 rounded-full bg-[#1b2235]" />
                    ))}
                  </span>
                </div>
              )}
              <div className="mt-4 flex justify-between text-[11px] text-ink-400">
                {[0, 25, 50, 75, 100].map((v) => (
                  <span key={v} className="num">
                    {v}
                  </span>
                ))}
              </div>
            </div>

            <dl className="mt-8 grid grid-cols-3 gap-3">
              <div className="surface-raised px-3 py-3 text-center">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Multiplier</dt>
                <dd className="num mt-1 text-xl font-semibold text-gold-300">{valid ? (multE4 / 10_000).toFixed(4) : '—'}×</dd>
              </div>
              <div className="surface-raised px-3 py-3 text-center">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Win chance</dt>
                <dd className="num mt-1 text-xl font-semibold text-ink-100">{(winCount / 100).toFixed(2)}%</dd>
              </div>
              <div className="surface-raised px-3 py-3 text-center">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Roll {direction}</dt>
                <dd className="num mt-1 text-xl font-semibold text-ink-100">{(target / 100).toFixed(2)}</dd>
              </div>
            </dl>
          </div>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy} />

            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Direction</div>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1" role="radiogroup" aria-label="Direction">
                {(['under', 'over'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={direction === d}
                    onClick={() => direction !== d && flip()}
                    className={cn('h-9 rounded-lg text-sm font-medium transition-colors', direction === d ? 'bg-ink-700 text-gold-200' : 'text-ink-400 hover:text-ink-200')}
                  >
                    Roll {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="dice-target" className="mb-1.5 flex justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                <span>Target</span>
                <span className="num normal-case tracking-normal text-ink-300">{(target / 100).toFixed(2)}</span>
              </label>
              <input
                id="dice-target"
                type="range"
                min={minTarget}
                max={maxTarget}
                step={1}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
                className="w-full accent-[var(--color-gold-500)]"
                aria-valuetext={`Roll ${direction} ${(target / 100).toFixed(2)}, ${(winCount / 100).toFixed(2)} percent chance`}
              />
              <div className="mt-2 grid grid-cols-4 gap-1.5" role="group" aria-label="Risk profiles">
                {PROFILES.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setChance(p.chance)}
                    className={cn('rounded-lg border px-1 py-1.5 text-[11px] transition-colors', winCount === p.chance ? 'border-gold-500 bg-gold-800/30 text-gold-200' : 'border-ink-700 text-ink-300 hover:border-ink-500')}
                  >
                    <div className="font-medium">{p.label}</div>
                    <div className="num text-ink-400">{(p.chance / 100).toFixed(1)}%</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
              <Row label="Payout on win" value={`${formatChips(payoutOnWin)} chips`} strong />
              <Row label="Profit on win" value={`${formatChips(Math.max(0, payoutOnWin - stake), { sign: true })}`} />
              <Row label="Theoretical RTP" value={`${(rtp * 100).toFixed(4)}%`} />
            </div>

            <Button
              variant="primary"
              size="lg"
              block
              loading={busy}
              disabled={Boolean(problem)}
              onClick={() => start({ amount: stake, target, direction }, description)}
              data-testid="dice-roll-button"
            >
              {problem ?? `Roll ${direction} ${(target / 100).toFixed(2)}`}
            </Button>

            {round && revealed && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="Inputs used for the latest roll" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent rolls" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="dice" refreshKey={revealed ? round?.id : null} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-400">{label}</span>
      <span className={cn('num', strong ? 'font-semibold text-ink-100' : 'text-ink-200')}>{value}</span>
    </div>
  );
}
