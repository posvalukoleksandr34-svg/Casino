'use client';

import { useEffect, useState } from 'react';
import { kenoHitProbability, KENO_MAX_PICKS, KENO_NUMBERS, type KenoConfig, type KenoState } from '@/engine/games/keno';
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

/** Unbiased browser-side shortcut for choosing numbers; it has no influence on the draw. */
function randomPicks(count: number): number[] {
  const pool = Array.from({ length: KENO_NUMBERS }, (_, i) => i + 1);
  const buf = new Uint32Array(1);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const limit = Math.floor(0x1_0000_0000 / (i + 1)) * (i + 1);
    let x: number;
    do {
      crypto.getRandomValues(buf);
      x = buf[0]!;
    } while (x >= limit);
    const j = x % (i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

export function KenoGame({ config, limits, status }: { config: KenoConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const reduced = useReducedMotion();
  const { round, busy, error, start, pending, retryPending, discardPending, commitBalance } = useRound<KenoState>('keno', { deferBalance: true });
  const audio = useGameAudio('keno');
  const [stake, setStake] = useState(1_000);
  const [picks, setPicks] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(true);

  const n = picks.length;
  const row = n > 0 ? config.table[String(n)]! : [];
  const maxPayout = n > 0 ? mulDivFloor(stake, Math.max(...row), 100) : 0;
  const problem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : n === 0
        ? 'Pick 1 to 10 numbers'
        : (stakeProblem(stake, limits.minStake, limits.maxStake, balance) ?? (maxPayout > limits.maxPayoutPerRound ? 'Potential payout above table limit — lower the stake' : null));

  // The draw is already settled when it arrives; a short fade-in presents it, nothing more.
  useEffect(() => {
    if (!round) return;
    const hits = round.state.hits.length;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const announce = () => {
      audio.play('land');
      if (hits === 0) audio.play('miss');
      // One rising ping per hit, spaced so each is heard.
      for (let i = 0; i < Math.min(hits, 10); i++) timers.push(setTimeout(() => audio.play('hit', { rate: 1 + i * 0.06 }), 60 + i * 90));
    };
    if (reduced) {
      setRevealed(true);
      commitBalance();
      announce();
      return () => timers.forEach(clearTimeout);
    }
    setRevealed(false);
    audio.play('draw');
    timers.push(
      setTimeout(() => {
        setRevealed(true);
        commitBalance();
        announce();
      }, 450),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  const toggle = (x: number) => {
    if (busy) return;
    setPicks((p) => (p.includes(x) ? p.filter((y) => y !== x) : p.length >= KENO_MAX_PICKS ? p : [...p, x].sort((a, b) => a - b)));
  };

  const last = round?.state ?? null;
  const drawn = last && revealed ? last.drawn : [];
  const resultFor = last && revealed && last.picks.join(',') === picks.join(',');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardBody className="space-y-5 py-6">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-400" aria-live="polite">
                {n} of {KENO_MAX_PICKS} picked
                {last && revealed && ` · last draw: ${last.hits.length} hit${last.hits.length === 1 ? '' : 's'}`}
              </span>
              {last && revealed && <span className="num font-semibold text-gold-300">{(last.multiplierE2 / 100).toFixed(2)}×</span>}
            </div>
            <div className="grid grid-cols-8 gap-1.5 sm:gap-2" role="group" aria-label="Keno board, numbers 1 to 40">
              {Array.from({ length: KENO_NUMBERS }, (_, i) => i + 1).map((x) => {
                const picked = picks.includes(x);
                const isDrawn = drawn.includes(x);
                const hit = picked && isDrawn && resultFor;
                return (
                  <button
                    key={x}
                    type="button"
                    data-number={x}
                    aria-pressed={picked}
                    aria-label={`${x}${picked ? ', picked' : ''}${isDrawn ? ', drawn' : ''}`}
                    disabled={busy || (!picked && n >= KENO_MAX_PICKS)}
                    onClick={() => toggle(x)}
                    className={cn(
                      'num grid aspect-square place-items-center rounded-full border text-sm font-bold transition-[transform,box-shadow,background-color,border-color] duration-300 sm:text-base',
                      hit
                        ? 'animate-card-flip border-[#c9ffe9] bg-[radial-gradient(circle_at_35%_30%,#d8fff0,#38d6b0_55%,#0d6b57)] text-[#062b23] shadow-[0_0_18px_-2px_rgb(94_230_200/0.85)] ring-2 ring-[#5ee6c8]/60'
                        : picked
                          ? 'border-gold-200/80 bg-[radial-gradient(circle_at_35%_30%,#fff1c8,#d9b25e_55%,#7b622f)] text-ink-950 shadow-[0_0_14px_-3px_rgb(232_196_120/0.75)]'
                          : isDrawn
                            ? 'animate-card-flip border-white/70 bg-[radial-gradient(circle_at_35%_30%,#ffffff,#d9d4c7_60%,#8e887a)] text-ink-950'
                            : 'border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.02] text-ink-200 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_6px_12px_-8px_rgb(0_0_0/0.9)] hover:-translate-y-0.5 hover:border-gold-400/50 hover:text-ink-100',
                      'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0',
                    )}
                  >
                    {x}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-ink-400" aria-hidden="true">
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff1c8,#d9b25e_55%,#7b622f)]" /> your pick</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff,#d9d4c7_60%,#8e887a)]" /> drawn</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[radial-gradient(circle_at_35%_30%,#d8fff0,#38d6b0_55%,#0d6b57)]" /> hit</span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPicks(randomPicks(Math.max(1, n || 5)))} disabled={busy}>
                Random pick
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPicks([])} disabled={busy || n === 0}>
                Clear
              </Button>
            </div>
            <div className="rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{n ? `Pays with ${n} pick${n === 1 ? '' : 's'}` : 'Payout table'}</div>
              {n === 0 ? (
                <p className="text-ink-400">Pick numbers to see what each number of hits pays and how likely it is.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-ink-400">
                      <th className="py-1 text-left font-normal">Hits</th>
                      <th className="py-1 text-right font-normal">Multiplier</th>
                      <th className="py-1 text-right font-normal">Chance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.map((m, k) =>
                      m > 0 ? (
                        <tr key={k} className={cn('border-t border-ink-800', last && revealed && resultFor && last.hits.length === k && 'text-positive')}>
                          <td className="num py-1">{k}</td>
                          <td className="num py-1 text-right">{(m / 100).toFixed(2)}×</td>
                          <td className="num py-1 text-right">{(kenoHitProbability(n, k) * 100).toPrecision(3)}%</td>
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
              )}
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              loading={busy || !revealed}
              disabled={Boolean(problem) || !revealed}
              onClick={() => start({ amount: stake, picks }, `${formatChips(stake)} chips, ${n} keno pick${n === 1 ? '' : 's'}`)}
              data-testid="keno-play"
            >
              {problem ?? 'Draw 10 numbers'}
            </Button>
            {round && revealed && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="The draw depends only on these inputs, never on your picks" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent rounds" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="keno" refreshKey={revealed ? round?.id : null} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}
