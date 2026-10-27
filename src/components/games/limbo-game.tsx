'use client';

import { useEffect, useRef, useState } from 'react';
import { limboWinProbability, type LimboConfig, type LimboState } from '@/engine/games/limbo';
import { formatChips, mulDivFloor } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { FairnessStrip, PendingRecovery, RecentRounds, ResultLine, RoundError } from './round-panels';
import { StakeInput, stakeProblem } from './stake-input';
import { useReducedMotion } from './use-reduced-motion';
import { useRound } from './use-round';

const PRESETS = [150, 200, 500, 1_000, 10_000];

export function LimboGame({ config, limits, status }: { config: LimboConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const reduced = useReducedMotion();
  const { round, busy, error, start, pending, retryPending, discardPending, commitBalance } = useRound<LimboState>('limbo', { deferBalance: true });
  const [stake, setStake] = useState(1_000);
  const [text, setText] = useState('2.00');
  const [display, setDisplay] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(true);
  const anim = useRef<number | null>(null);

  const parsed = Number(text);
  const targetE2 = Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN;
  const valid = Number.isInteger(targetE2) && targetE2 >= config.minTargetE2 && targetE2 <= config.maxTargetE2 && /^\d+(\.\d{1,2})?$/.test(text.trim());
  const chance = valid ? limboWinProbability(targetE2, config.houseEdgeBp) : 0;
  const payoutOnWin = valid ? mulDivFloor(stake, targetE2, 100) : 0;

  const problem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : !valid
        ? `Target must be ${(config.minTargetE2 / 100).toFixed(2)}–${(config.maxTargetE2 / 100).toLocaleString('en-US')}×`
        : (stakeProblem(stake, limits.minStake, limits.maxStake, balance) ?? (payoutOnWin > limits.maxPayoutPerRound ? 'Potential payout above table limit — lower the stake' : null));

  // Presentational count-up to the authoritative result (logarithmic, so large results do not take longer).
  useEffect(() => {
    if (!round) return;
    const final = round.state.resultE2;
    if (anim.current) cancelAnimationFrame(anim.current);
    if (reduced) {
      setDisplay(final);
      setRevealed(true);
      commitBalance();
      return;
    }
    setRevealed(false);
    const t0 = performance.now();
    const dur = 600;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(100 * Math.exp(Math.log(final / 100) * eased)));
      if (p < 1) anim.current = requestAnimationFrame(step);
      else {
        setDisplay(final);
        setRevealed(true);
        commitBalance();
      }
    };
    anim.current = requestAnimationFrame(step);
    return () => {
      if (anim.current) cancelAnimationFrame(anim.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  const last = round?.state;
  const show = Boolean(last && revealed);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <div className="relative px-6 pb-10 pt-12 text-center sm:px-10">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_at_top,rgb(199_163_91/0.10),transparent_70%)]" />
            <div className="relative">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-400">{last ? 'Result' : 'Ready'}</div>
              <div
                data-testid="limbo-result"
                aria-live="polite"
                className={cn('num mt-2 text-7xl font-light tracking-tight sm:text-8xl', !show ? 'text-ink-200' : last!.won ? 'text-positive' : 'text-ink-300')}
              >
                {display === null ? '—' : `${(display / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`}
              </div>
              <div className="mt-4 h-5 text-sm text-ink-400">
                {show && (last!.won ? `Win — target ${(last!.targetE2 / 100).toFixed(2)}× reached` : `No win — target was ${(last!.targetE2 / 100).toFixed(2)}×`)}
              </div>
            </div>
            <dl className="relative mt-10 grid grid-cols-3 gap-3">
              <div className="surface-raised px-3 py-3">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Target</dt>
                <dd className="num mt-1 text-xl font-semibold text-gold-300">{valid ? `${(targetE2 / 100).toFixed(2)}×` : '—'}</dd>
              </div>
              <div className="surface-raised px-3 py-3">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-400">Win chance</dt>
                <dd className="num mt-1 text-xl font-semibold text-ink-100">{valid ? `${(chance * 100).toFixed(chance < 0.01 ? 4 : 2)}%` : '—'}</dd>
              </div>
              <div className="surface-raised px-3 py-3">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-400">RTP</dt>
                <dd className="num mt-1 text-xl font-semibold text-ink-100">{valid ? `${(chance * (targetE2 / 100) * 100).toFixed(2)}%` : '—'}</dd>
              </div>
            </dl>
          </div>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy} />
            <div>
              <label htmlFor="limbo-target" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Target multiplier
              </label>
              <div className={cn('flex items-center rounded-xl border bg-ink-900 pr-3', valid ? 'border-ink-600 focus-within:border-gold-500' : 'border-negative/60')}>
                <input
                  id="limbo-target"
                  inputMode="decimal"
                  value={text}
                  onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ''))}
                  className="num h-11 w-full bg-transparent px-3 text-ink-100 outline-none"
                  aria-invalid={!valid}
                  aria-describedby="limbo-target-hint"
                />
                <span className="text-ink-400">×</span>
              </div>
              <p id="limbo-target-hint" className="mt-1 text-xs text-ink-400">
                {(config.minTargetE2 / 100).toFixed(2)}× to {(config.maxTargetE2 / 100).toLocaleString('en-US')}×, two decimals.
              </p>
              <div className="mt-2 grid grid-cols-5 gap-1.5" role="group" aria-label="Target presets">
                {PRESETS.filter((t) => t >= config.minTargetE2 && t <= config.maxTargetE2).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setText((t / 100).toFixed(2))}
                    className={cn('h-8 rounded-lg border text-xs', targetE2 === t ? 'border-gold-500 bg-gold-800/30 text-gold-200' : 'border-ink-700 text-ink-300 hover:border-ink-500')}
                  >
                    {t / 100}×
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
              <Row label="Payout on win" value={`${formatChips(payoutOnWin)} chips`} strong />
              <Row label="Profit on win" value={formatChips(Math.max(0, payoutOnWin - stake), { sign: true })} />
              <Row label="Chance of no win" value={valid ? `${((1 - chance) * 100).toFixed(2)}%` : '—'} />
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              loading={busy || !revealed}
              disabled={Boolean(problem) || !revealed}
              onClick={() => start({ amount: stake, targetE2 }, `${formatChips(stake)} chips, target ${(targetE2 / 100).toFixed(2)}×`)}
              data-testid="limbo-play"
            >
              {problem ?? `Play for ${(targetE2 / 100).toFixed(2)}×`}
            </Button>
            {round && revealed && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="Inputs used for the latest result" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent rounds" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="limbo" refreshKey={revealed ? round?.id : null} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
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
