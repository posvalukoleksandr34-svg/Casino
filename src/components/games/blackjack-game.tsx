'use client';

import { useEffect, useState } from 'react';
import { insuranceEdge, label, rankOf, suitOf, type ActionType, type BlackjackConfig, type BlackjackView } from '@/engine/games/blackjack';
import { basicStrategy } from '@/engine/games/blackjack/strategy';
import { formatChips } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Toggle } from '../ui/form';
import { Kbd } from '../ui/misc';
import { FairnessStrip, PendingRecovery, RecentRounds, ResultLine, RoundError } from './round-panels';
import { StakeInput, stakeProblem } from './stake-input';
import { useRound } from './use-round';

const RANK_TEXT = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_TEXT = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
const ACTION_LABEL: Record<Exclude<ActionType, 'insurance'>, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split' };
const KEYS: Record<string, Exclude<ActionType, 'insurance'>> = { h: 'hit', s: 'stand', d: 'double', p: 'split' };

function PlayingCard({ card, index }: { card: number | null; index: number }) {
  if (card === null) {
    return (
      <div
        className="h-24 w-16 shrink-0 rounded-lg border border-gold-700/60 bg-[repeating-linear-gradient(45deg,var(--color-ink-750)_0_6px,var(--color-ink-800)_6px_12px)] shadow-md animate-rise sm:h-28 sm:w-20"
        style={{ animationDelay: `${index * 90}ms` }}
        role="img"
        aria-label="Face-down card"
      />
    );
  }
  const red = suitOf(card) === 1 || suitOf(card) === 2;
  const rank = RANK_TEXT[rankOf(card)]!;
  const suit = SUIT_TEXT[suitOf(card)]!;
  return (
    <div
      className={cn('relative h-24 w-16 shrink-0 rounded-lg border border-ink-300 bg-[#f6f3ec] shadow-md animate-rise sm:h-28 sm:w-20', red ? 'text-[#b8322b]' : 'text-[#1b1c20]')}
      style={{ animationDelay: `${index * 90}ms` }}
      role="img"
      aria-label={`${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)]}`}
      title={label(card)}
    >
      <span className="absolute left-1.5 top-1 text-sm font-semibold leading-none sm:text-base">
        {rank}
        <br />
        {suit}
      </span>
      <span className="absolute inset-0 grid place-items-center text-3xl sm:text-4xl" aria-hidden="true">
        {suit}
      </span>
    </div>
  );
}

function CardRow({ cards }: { cards: (number | null)[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 sm:-space-x-6 sm:gap-0 sm:hover:space-x-1">
      {cards.map((c, i) => (
        <PlayingCard key={`${i}-${c ?? 'x'}`} card={c} index={i} />
      ))}
    </div>
  );
}

function totalText(t: { total: number; soft: boolean }): string {
  return t.soft && t.total < 21 ? `${t.total - 10} / ${t.total}` : String(t.total);
}

const OUTCOME_TEXT = { blackjack: 'Blackjack', win: 'Win', push: 'Push', lose: 'Lose', bust: 'Bust' } as const;

export function BlackjackGame({ config, limits, status }: { config: BlackjackConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const { round, setRound, busy, error, start, act, pending, retryPending, discardPending, loadActive } = useRound<BlackjackView>('blackjack');
  const [stake, setStake] = useState(1000);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (user) void loadActive();
  }, [user, loadActive]);

  const s = round?.state ?? null;
  const open = round?.status === 'OPEN' && s !== null;
  const allowed = open ? s.allowed : [];
  const activeHand = open && s.phase === 'player' ? s.hands[s.active] : undefined;
  const insurancePhase = open && s.phase === 'insurance';
  const committed = s ? s.hands.reduce((a, h) => a + h.stake, 0) + (s.insurance.taken ? s.insurance.stake : 0) : 0;

  const canAfford = (a: ActionType) => (a === 'double' || a === 'split' ? (activeHand?.stake ?? 0) <= balance : true);
  const suggestion =
    hint && activeHand && s && s.dealer[0] !== null && s.dealer[0] !== undefined
      ? basicStrategy(
          activeHand.cards,
          s.dealer[0],
          allowed.filter((a) => canAfford(a)),
          { dealerHitsSoft17: config.dealerHitsSoft17, doubleAfterSplit: config.doubleAfterSplit },
        )
      : null;

  const startProblem = !user ? 'Sign in to play' : status !== 'ACTIVE' ? 'Game paused' : stakeProblem(stake, limits.minStake, limits.maxStake, balance);

  const doAction = (a: Exclude<ActionType, 'insurance'>) => {
    if (!open || busy || !allowed.includes(a) || !canAfford(a)) return;
    void act(round!.id, { type: a }, `${ACTION_LABEL[a].toLowerCase()} (hand ${s!.active + 1})`);
  };

  useEffect(() => {
    if (!open || s?.phase !== 'player') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const a = KEYS[e.key.toLowerCase()];
      if (a) {
        e.preventDefault();
        doAction(a);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <CardBody className="min-h-[26rem] space-y-8 bg-[radial-gradient(ellipse_at_50%_0%,rgb(31_92_68/0.35),transparent_70%)] py-8">
            <section aria-label="Dealer">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Dealer</h2>
                {s && (
                  <span className="num text-sm text-ink-300" data-testid="bj-dealer-total">
                    {s.dealerTotal !== null ? s.dealerTotal : s.dealer[0] != null ? `showing ${RANK_TEXT[rankOf(s.dealer[0])]}` : ''}
                  </span>
                )}
              </div>
              {s ? <CardRow cards={s.dealer} /> : <div className="h-24 sm:h-28" />}
              <p className="mt-3 text-xs text-ink-500">
                Dealer {config.dealerHitsSoft17 ? 'hits' : 'stands on'} soft 17 · blackjack pays {config.blackjackPays} · insurance pays 2:1
              </p>
            </section>

            <section aria-label="Your hands" className="space-y-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{s && s.hands.length > 1 ? 'Your hands' : 'Your hand'}</h2>
              {!s && <p className="text-sm text-ink-400">Choose a stake and deal. Every hand is dealt from a freshly shuffled {config.decks}-deck shoe.</p>}
              <div className="flex flex-wrap gap-6">
                {s?.hands.map((h, i) => {
                  const result = s.results?.[i];
                  const isActive = open && s.phase === 'player' && i === s.active;
                  return (
                    <div
                      key={i}
                      className={cn('rounded-xl border p-3 transition-colors', isActive ? 'border-gold-500 bg-gold-800/10' : 'border-transparent')}
                      aria-current={isActive ? 'true' : undefined}
                      data-testid={`bj-hand-${i}`}
                    >
                      <CardRow cards={h.cards} />
                      <div className="mt-2 flex items-center justify-between gap-4 text-sm">
                        <span className="num text-ink-200" data-testid={`bj-total-${i}`}>
                          {totalText(s.handTotals[i]!)}
                        </span>
                        <span className="num text-xs text-ink-400">
                          {formatChips(h.stake)}
                          {h.doubled ? ' · doubled' : ''}
                        </span>
                      </div>
                      {result && (
                        <div className={cn('mt-1 text-sm font-semibold', result.payout > h.stake ? 'text-positive' : result.payout === h.stake ? 'text-ink-200' : 'text-ink-400')}>
                          {OUTCOME_TEXT[result.outcome]} · {result.payout > 0 ? `pays ${formatChips(result.payout)}` : 'no payout'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {s?.outcomeSummary && (
                <p className="text-sm text-ink-300" role="status" data-testid="bj-outcome">
                  {s.outcomeSummary}
                  {s.insurance.taken && ` · insurance ${s.insurance.payout > 0 ? `paid ${formatChips(s.insurance.payout)}` : 'lost'}`}
                </p>
              )}
            </section>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            {open ? (
              <>
                <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-400">Total staked this round</span>
                    <span className="num text-ink-100">{formatChips(committed)}</span>
                  </div>
                  {activeHand && s.hands.length > 1 && (
                    <div className="flex justify-between">
                      <span className="text-ink-400">Playing</span>
                      <span className="num text-ink-200">
                        hand {s.active + 1} of {s.hands.length}
                      </span>
                    </div>
                  )}
                </div>

                {insurancePhase ? (
                  <div className="space-y-3">
                    <p className="text-sm text-ink-200">The dealer shows an ace. Insure against a dealer blackjack?</p>
                    <p className="text-xs text-ink-400">
                      Insurance costs {formatChips(s.insurance.stake)} and pays 2:1 if the dealer has blackjack. Its house edge is about {(insuranceEdge(config.decks) * 100).toFixed(1)}%, higher than the main game.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="secondary" loading={busy} disabled={s.insurance.stake > balance} onClick={() => act(round!.id, { type: 'insurance', take: true }, 'take insurance')} data-testid="bj-insure">
                        Take insurance
                      </Button>
                      <Button variant="primary" loading={busy} onClick={() => act(round!.id, { type: 'insurance', take: false }, 'decline insurance')} data-testid="bj-no-insurance">
                        No insurance
                      </Button>
                    </div>
                    {hint && <p className="text-xs text-gold-300">Basic strategy: decline insurance.</p>}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Actions">
                      {(['hit', 'stand', 'double', 'split'] as const).map((a) => {
                        const enabled = allowed.includes(a) && canAfford(a);
                        return (
                          <Button
                            key={a}
                            variant={suggestion === a ? 'primary' : 'secondary'}
                            size="lg"
                            disabled={!enabled || busy}
                            onClick={() => doAction(a)}
                            data-testid={`bj-${a}`}
                            title={allowed.includes(a) && !canAfford(a) ? 'Not enough chips for the additional stake' : undefined}
                          >
                            {ACTION_LABEL[a]}
                            <Kbd>{a === 'split' ? 'P' : a[0]!.toUpperCase()}</Kbd>
                          </Button>
                        );
                      })}
                    </div>
                    {suggestion && <p className="text-xs text-gold-300">Basic strategy suggests: {ACTION_LABEL[suggestion as Exclude<ActionType, 'insurance'>]}.</p>}
                    <p className="text-xs text-ink-500">Doubling or splitting adds a stake equal to the current hand&apos;s. You can leave and come back: this hand stays open.</p>
                  </>
                )}
              </>
            ) : (
              <>
                <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy} />
                <Button variant="primary" size="lg" block loading={busy} disabled={Boolean(startProblem)} onClick={() => start({ amount: stake }, `deal ${formatChips(stake)} chips`)} data-testid="bj-deal">
                  {startProblem ?? 'Deal'}
                </Button>
                {round && round.status !== 'OPEN' && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
                {round && round.status !== 'OPEN' && (
                  <Button variant="ghost" size="sm" onClick={() => setRound(null)}>
                    Clear table
                  </Button>
                )}
              </>
            )}
            <Toggle checked={hint} onChange={setHint} label="Show basic-strategy hint" description="Suggests the play that minimises the house edge for these rules. Off by default." />
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="The whole shoe order was fixed by these inputs when the hand was dealt" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent rounds" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="blackjack" refreshKey={round?.status === 'OPEN' ? null : round?.id} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}
