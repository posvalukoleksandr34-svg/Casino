'use client';

import { useEffect, useState } from 'react';
import { multiplierE4, survivalProbability, type MinesConfig, type MinesView } from '@/engine/games/mines';
import { formatChips, mulDivFloor } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { FairnessStrip, PendingRecovery, RecentRounds, ResultLine, RoundError } from './round-panels';
import { StakeInput, stakeProblem } from './stake-input';
import { useRound } from './use-round';
import { useGameAudio, useRoundCues } from './use-game-audio';
import { minesCues } from '@/lib/audio/cues';

const PRESETS = [1, 3, 5, 10, 24];

function Gem() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 drop-shadow-[0_0_8px_rgb(94_230_200/0.6)] sm:size-9" aria-hidden="true">
      <path d="M9 6h14l5 7-12 14L4 13z" fill="#38d6b0" />
      <path d="M9 6h14l5 7H4z" fill="#8ff5dc" />
      <path d="M4 13h24L16 27z" fill="#1fa587" />
      <path d="M12 13l4-7 4 7-4 14z" fill="#5ee6c8" opacity="0.85" />
      <path d="M4 13h24M9 6l3 7 4 14 4-14 3-7M12 13l4-7 4 7" fill="none" stroke="#e6fff8" strokeOpacity="0.55" strokeWidth="0.7" strokeLinejoin="round" />
      <path d="M10.5 8.5l3 0" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function Mine({ hit }: { hit?: boolean }) {
  const c = hit ? '#ff6b5e' : '#9aa0ab';
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 sm:size-9', hit && 'drop-shadow-[0_0_10px_rgb(255_107_94/0.8)]')} aria-hidden="true">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="16" y1="17" x2={16 + 12 * Math.cos((a * Math.PI) / 180)} y2={17 + 12 * Math.sin((a * Math.PI) / 180)} stroke={c} strokeWidth="2.2" strokeLinecap="round" />
      ))}
      <circle cx="16" cy="17" r="8.5" fill={hit ? '#c9372c' : '#4b4f5a'} stroke={c} strokeWidth="1.2" />
      <circle cx="13" cy="14" r="2.4" fill="#ffffff" opacity="0.65" />
    </svg>
  );
}

export function MinesGame({ config, limits, status }: { config: MinesConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const { round, setRound, busy, error, start, act, pending, retryPending, discardPending, loadActive } = useRound<MinesView>('mines');
  const [stake, setStake] = useState(1000);
  const [mineCount, setMineCount] = useState(3);
  const audio = useGameAudio('mines');
  const armCues = useRoundCues(round, minesCues, audio.play);

  useEffect(() => {
    if (user) void loadActive();
  }, [user, loadActive]);

  const s = round?.state ?? null;
  const playing = round?.status === 'OPEN' && s?.status === 'playing';
  const picks = s?.revealed.length ?? 0;
  const currentPayout = playing && picks > 0 ? mulDivFloor(s!.amount, s!.multiplierE4, 10_000) : 0;
  const firstMult = multiplierE4(config, mineCount, 1);
  const potentialMax = mulDivFloor(stake, multiplierE4(config, mineCount, 25 - mineCount), 10_000);

  const startProblem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : mineCount < config.minMines || mineCount > config.maxMines
        ? 'Choose a valid number of mines'
        : (stakeProblem(stake, limits.minStake, limits.maxStake, balance) ?? (potentialMax > limits.maxPayoutPerRound ? 'Potential payout above table limit — lower the stake' : null));

  const reveal = (tile: number) => {
    if (!playing || busy || s!.revealed.includes(tile)) return;
    audio.play('select');
    void act(round!.id, { type: 'reveal', tile }, `reveal tile ${tile + 1}`);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardBody className="flex flex-col items-center gap-6 bg-[radial-gradient(ellipse_80%_70%_at_50%_30%,rgb(20_90_84/0.35),transparent_75%),linear-gradient(180deg,rgb(4_30_30/0.6),rgb(3_14_15/0.7))] py-8">
            <div className="flex w-full max-w-md items-center justify-between text-sm">
              <span className="text-ink-400">{s ? `${s.mineCount} mine${s.mineCount === 1 ? '' : 's'} · ${picks} safe pick${picks === 1 ? '' : 's'}` : 'Choose your mines and start'}</span>
              <span className="num text-lg font-semibold text-gold-300" data-testid="mines-multiplier">
                {s ? `${(s.multiplierE4 / 10_000).toFixed(4)}×` : `${(firstMult / 10_000).toFixed(4)}× first pick`}
              </span>
            </div>
            <div className="grid w-full max-w-md grid-cols-5 gap-2 sm:gap-3" role="grid" aria-label="Mines grid">
              {Array.from({ length: 25 }, (_, tile) => {
                const revealed = s?.revealed.includes(tile);
                const isMine = s?.mines?.includes(tile);
                const hit = s?.hitMine === tile;
                return (
                  <button
                    key={tile}
                    type="button"
                    role="gridcell"
                    data-tile={tile}
                    disabled={!playing || busy || revealed}
                    onClick={() => reveal(tile)}
                    aria-label={`Tile ${tile + 1}${revealed ? ', safe' : isMine ? ', mine' : ''}`}
                    className={cn(
                      'grid aspect-square place-items-center rounded-2xl border transition-[transform,border-color,box-shadow,background-color] duration-200',
                      revealed && 'animate-card-flip border-[#5ee6c8]/60 bg-[radial-gradient(circle_at_50%_35%,rgb(94_230_200/0.32),rgb(8_48_44/0.75)_70%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_0_18px_-4px_rgb(94_230_200/0.45)]',
                      !revealed && isMine && (hit ? 'animate-card-flip border-[#ff6b5e]/80 bg-[radial-gradient(circle,rgb(255_107_94/0.4),rgb(60_10_10/0.8)_70%)] shadow-[0_0_24px_-2px_rgb(255_107_94/0.6)]' : 'border-white/10 bg-black/30 opacity-75'),
                      !revealed && !isMine && 'border-white/10 bg-gradient-to-b from-white/[0.10] to-white/[0.02] shadow-[inset_0_1px_0_rgb(255_255_255/0.14),inset_0_-3px_0_rgb(0_0_0/0.35),0_8px_16px_-10px_rgb(0_0_0/0.9)] backdrop-blur-sm',
                      playing && !revealed && 'hover:-translate-y-0.5 hover:border-[#5ee6c8]/60 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_0_20px_-6px_rgb(94_230_200/0.6)] active:translate-y-0',
                    )}
                  >
                    {revealed ? <Gem /> : isMine ? <Mine hit={hit} /> : null}
                  </button>
                );
              })}
            </div>
            {s && !playing && (
              <p className="text-sm text-ink-400" role="status">
                {s.status === 'busted' ? 'A mine ended the round. All mine positions are now shown.' : `Cashed out at ${(s.multiplierE4 / 10_000).toFixed(4)}×.`}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            {playing ? (
              <>
                <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-400">Stake</span>
                    <span className="num text-ink-100">{formatChips(s!.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-400">Cash-out value now</span>
                    <span className="num font-semibold text-ink-100">{formatChips(currentPayout)}</span>
                  </div>
                  {s!.nextMultiplierE4 !== null && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-ink-400">Next safe pick</span>
                        <span className="num text-ink-200">{(s!.nextMultiplierE4 / 10_000).toFixed(4)}×</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-400">Chance next pick is safe</span>
                        <span className="num text-ink-200">{((s!.nextSafeProbability ?? 0) * 100).toFixed(2)}%</span>
                      </div>
                    </>
                  )}
                </div>
                <Button variant="primary" size="lg" block loading={busy} disabled={picks === 0} onClick={() => act(round!.id, { type: 'cashout' }, 'cash out')} data-testid="mines-cashout">
                  {picks === 0 ? 'Pick a tile' : `Cash out ${formatChips(currentPayout)}`}
                </Button>
                <p className="text-xs text-ink-400">You can leave and come back: this round stays open until you cash out or hit a mine.</p>
              </>
            ) : (
              <>
                <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy} />
                <div>
                  <label htmlFor="mine-count" className="mb-1.5 flex justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                    <span>Mines</span>
                    <span className="num normal-case tracking-normal text-ink-300">{mineCount}</span>
                  </label>
                  <input id="mine-count" type="range" min={config.minMines} max={config.maxMines} value={mineCount} onChange={(e) => setMineCount(Number(e.target.value))} className="w-full accent-[var(--color-gold-500)]" />
                  <div className="mt-2 grid grid-cols-5 gap-1.5" role="group" aria-label="Mine presets">
                    {PRESETS.filter((n) => n >= config.minMines && n <= config.maxMines).map((n) => (
                      <button key={n} type="button" onClick={() => setMineCount(n)} className={cn('h-8 rounded-lg border text-xs', mineCount === n ? 'border-gold-500 bg-gold-800/30 text-gold-200' : 'border-ink-700 text-ink-300 hover:border-ink-500')}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-400">First pick safe</span>
                    <span className="num text-ink-200">{(survivalProbability(mineCount, 1) * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-400">First pick pays</span>
                    <span className="num text-ink-200">{(firstMult / 10_000).toFixed(4)}×</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-400">Max multiplier</span>
                    <span className="num text-ink-200">{(multiplierE4(config, mineCount, 25 - mineCount) / 10_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}×</span>
                  </div>
                </div>
                <Button variant="primary" size="lg" block loading={busy} disabled={Boolean(startProblem)} onClick={() => (armCues(), audio.play('select'), start({ amount: stake, mines: mineCount }, `${formatChips(stake)} chips, ${mineCount} mines`))} data-testid="mines-start">
                  {startProblem ?? 'Start round'}
                </Button>
                {round && round.status !== 'OPEN' && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
                {round && round.status !== 'OPEN' && (
                  <Button variant="ghost" size="sm" onClick={() => setRound(null)}>
                    Clear board
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
          <CardHeader title="Provably fair" subtitle="Mine positions were fixed by these inputs when the round started" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent rounds" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="mines" refreshKey={round?.status === 'OPEN' ? null : round?.id} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}
