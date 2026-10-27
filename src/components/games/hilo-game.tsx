'use client';

import { useEffect, useState } from 'react';
import { hiloMultiplierE4, rankOf, suitOf, type HiloConfig, type HiloView } from '@/engine/games/hilo';
import { formatChips, mulDivFloor } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { FairnessStrip, PendingRecovery, RecentRounds, ResultLine, RoundError } from './round-panels';
import { StakeInput, stakeProblem } from './stake-input';
import { useRound } from './use-round';

const RANK_TEXT = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
const SUIT_TEXT = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

function Face({ card, size = 'lg', dim }: { card: number; size?: 'lg' | 'sm'; dim?: boolean }) {
  const r = rankOf(card);
  const s = suitOf(card);
  const red = s === 1 || s === 2;
  return (
    <div
      role="img"
      aria-label={`${RANK_NAMES[r - 1]} of ${SUIT_NAMES[s]}`}
      className={cn(
        'relative shrink-0 rounded-lg border border-ink-300 bg-[#f6f3ec] shadow-md animate-rise',
        size === 'lg' ? 'h-36 w-24 sm:h-44 sm:w-32' : 'h-14 w-10',
        red ? 'text-[#b8322b]' : 'text-[#1b1c20]',
        dim && 'opacity-50',
      )}
    >
      <span className={cn('absolute left-1.5 top-1 font-semibold leading-none', size === 'lg' ? 'text-xl' : 'text-[11px]')}>
        {RANK_TEXT[r - 1]}
        <br />
        {SUIT_TEXT[s]}
      </span>
      {size === 'lg' && (
        <span className="absolute inset-0 grid place-items-center text-5xl sm:text-6xl" aria-hidden="true">
          {SUIT_TEXT[s]}
        </span>
      )}
    </div>
  );
}

export function HiloGame({ config, limits, status }: { config: HiloConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const { round, setRound, busy, error, start, act, pending, retryPending, discardPending, loadActive } = useRound<HiloView>('hilo');
  const [stake, setStake] = useState(1_000);

  useEffect(() => {
    if (user) void loadActive();
  }, [user, loadActive]);

  const s = round?.state ?? null;
  const playing = round?.status === 'OPEN' && s?.status === 'playing';
  const correct = s?.factors.length ?? 0;
  const cashValue = playing && correct > 0 ? mulDivFloor(s!.amount, s!.multiplierE4, 10_000) : 0;
  const capPayout = mulDivFloor(stake, config.maxMultiplierE4, 10_000);

  const startProblem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : (stakeProblem(stake, limits.minStake, limits.maxStake, balance) ?? (capPayout > limits.maxPayoutPerRound ? 'Potential payout above table limit — lower the stake' : null));

  const guess = (direction: 'higher' | 'lower') => act(round!.id, { type: 'guess', direction }, `guess ${direction}`);
  const history = s?.steps.slice(0, -1) ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardBody className="flex flex-col items-center gap-6 py-8">
            <div className="flex w-full max-w-lg items-center justify-between text-sm">
              <span className="text-ink-400">{s ? `${correct} correct guess${correct === 1 ? '' : 'es'} · ${s.skipsLeft} skip${s.skipsLeft === 1 ? '' : 's'} left` : 'Start a round to turn over the first card'}</span>
              <span className="num text-lg font-semibold text-gold-300" data-testid="hilo-multiplier">
                {s ? `${(s.multiplierE4 / 10_000).toFixed(4)}×` : `up to ${(config.maxMultiplierE4 / 10_000).toLocaleString('en-US')}×`}
              </span>
            </div>
            <div className="flex min-h-44 items-center justify-center" data-testid="hilo-current">
              {s ? (
                <Face key={`${round!.id}-${s.position}`} card={s.currentCard} />
              ) : (
                <div className="h-36 w-24 rounded-lg border border-gold-700/60 bg-[repeating-linear-gradient(45deg,var(--color-ink-750)_0_6px,var(--color-ink-800)_6px_12px)] sm:h-44 sm:w-32" role="img" aria-label="Face-down card" />
              )}
            </div>
            {s && !playing && (
              <p className="text-sm text-ink-400" role="status">
                {s.status === 'busted' ? 'Wrong guess: the round has ended.' : `Cashed out at ${(s.multiplierE4 / 10_000).toFixed(4)}×.`}
              </p>
            )}
            {history.length > 0 && (
              <div className="w-full max-w-lg">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Cards so far</div>
                <ol className="flex flex-wrap gap-1.5" aria-label="Cards so far">
                  {s!.steps.map((st, i) => (
                    <li key={i} className="flex flex-col items-center gap-0.5">
                      <Face card={st.card} size="sm" dim={st.via === 'skip'} />
                      <span className={cn('text-[10px]', st.correct === true ? 'text-positive' : st.correct === false ? 'text-negative' : 'text-ink-400')}>
                        {st.via === 'start' ? 'start' : st.via === 'skip' ? 'skip' : `${st.via === 'higher' ? '↑' : '↓'} ${st.correct ? '✓' : '✗'}`}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            {playing ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(['higher', 'lower'] as const).map((d) => {
                    const o = s![d];
                    return (
                      <Button key={d} variant="secondary" size="lg" disabled={!o?.available || busy} onClick={() => guess(d)} data-testid={`hilo-${d}`} className="h-auto flex-col py-2.5">
                        <span className="font-semibold">{d === 'higher' ? 'Higher ↑' : 'Lower ↓'}</span>
                        <span className="num text-xs text-ink-300">{o?.available ? `${(o.probability * 100).toFixed(2)}% · ${(o.multiplierE4 / 10_000).toFixed(4)}×` : 'not possible'}</span>
                      </Button>
                    );
                  })}
                </div>
                <p className="text-xs text-ink-400">Strictly higher or strictly lower; an equal rank loses (chance 1/13).</p>
                <Button variant="ghost" size="sm" block disabled={busy || s!.skipsLeft === 0} onClick={() => act(round!.id, { type: 'skip' }, 'skip card')} data-testid="hilo-skip">
                  Skip this card ({s!.skipsLeft} left)
                </Button>
                <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-400">Stake</span>
                    <span className="num text-ink-100">{formatChips(s!.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-400">Cash-out value now</span>
                    <span className="num font-semibold text-ink-100">{formatChips(cashValue)}</span>
                  </div>
                </div>
                <Button variant="primary" size="lg" block loading={busy} disabled={!s!.canCashOut} onClick={() => act(round!.id, { type: 'cashout' }, 'cash out')} data-testid="hilo-cashout">
                  {s!.canCashOut ? `Cash out ${formatChips(cashValue)}` : 'Make a correct guess first'}
                </Button>
                <p className="text-xs text-ink-400">You can leave and come back: this round stays open until you cash out or guess wrong.</p>
              </>
            ) : (
              <>
                <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy} />
                <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-400">Safest first guess</span>
                    <span className="num text-ink-200">{((12 / 13) * 100).toFixed(2)}% · {(hiloMultiplierE4(config.houseEdgeBp, [12]) / 10_000).toFixed(4)}×</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-400">Multiplier cap</span>
                    <span className="num text-ink-200">{(config.maxMultiplierE4 / 10_000).toLocaleString('en-US')}×</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-400">Skips per round</span>
                    <span className="num text-ink-200">{config.maxSkips}</span>
                  </div>
                </div>
                <Button variant="primary" size="lg" block loading={busy} disabled={Boolean(startProblem)} onClick={() => start({ amount: stake }, `${formatChips(stake)} chips, hi-lo`)} data-testid="hilo-start">
                  {startProblem ?? 'Start round'}
                </Button>
                {round && round.status !== 'OPEN' && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
                {round && round.status !== 'OPEN' && (
                  <Button variant="ghost" size="sm" onClick={() => setRound(null)}>
                    Clear table
                  </Button>
                )}
              </>
            )}
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="The whole card sequence was fixed by these inputs when the round started" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent rounds" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="hilo" refreshKey={round?.status === 'OPEN' ? null : round?.id} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}
