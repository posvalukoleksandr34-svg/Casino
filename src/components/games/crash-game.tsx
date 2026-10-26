'use client';

import { useEffect, useRef, useState } from 'react';
import { survivalAt, type CrashConfig, type CrashView } from '@/engine/games/crash';
import { formatChips, mulDivFloor } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Toggle } from '../ui/form';
import { FairnessStrip, PendingRecovery, RecentRounds, ResultLine, RoundError } from './round-panels';
import { StakeInput, stakeProblem } from './stake-input';
import { useRound } from './use-round';

const W = 640;
const H = 300;

/** Curve of e^{r t} from 0 to `toMs`, scaled into the viewBox. Purely illustrative. */
function curvePath(rate: number, toMs: number, spanMs: number, maxMult: number): string {
  const pts: string[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i += 1) {
    const t = (toMs * i) / steps;
    const m = Math.exp(rate * t);
    const x = 40 + ((W - 60) * t) / spanMs;
    const y = H - 30 - ((H - 60) * (m - 1)) / (maxMult - 1);
    pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join('');
}

export function CrashGame({ config, limits, status }: { config: CrashConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const { round, setRound, busy, error, start, act, pending, retryPending, discardPending, loadActive, reload, serverNow } = useRound<CrashView>('crash');
  const [stake, setStake] = useState(1000);
  const [autoOn, setAutoOn] = useState(false);
  const [autoText, setAutoText] = useState('2.00');
  const [elapsed, setElapsed] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (user) void loadActive();
  }, [user, loadActive]);

  const s = round?.state ?? null;
  const flying = round?.status === 'OPEN' && s?.status === 'flying';
  const startedAt = round ? Date.parse(round.startedAt) : 0;

  // Animate from the server clock while the round is open.
  useEffect(() => {
    if (!flying) return;
    const tick = () => {
      setElapsed(Math.max(0, serverNow() - startedAt));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [flying, serverNow, startedAt]);

  // Poll so the round settles (and the crash point is revealed) as soon as it happens.
  useEffect(() => {
    if (!flying || !round) return;
    const id = setInterval(() => void reload(round.id), 300);
    return () => clearInterval(id);
  }, [flying, round, reload]);

  const autoE2 = autoOn ? Math.round(Number(autoText) * 100) : undefined;
  const autoValid = autoE2 === undefined || (Number.isFinite(autoE2) && autoE2 >= 101 && autoE2 <= config.maxMultiplierE2);
  const maxPayout = mulDivFloor(stake, autoE2 ?? config.maxMultiplierE2, 100);
  const problem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : !autoValid
        ? `Auto cash-out must be between 1.01× and ${(config.maxMultiplierE2 / 100).toFixed(2)}×`
        : (stakeProblem(stake, limits.minStake, limits.maxStake, balance) ?? (maxPayout > limits.maxPayoutPerRound ? 'Potential payout above table limit — lower the stake or set an auto cash-out' : null));

  const liveMult = flying ? Math.exp(s!.growthPerMs * elapsed) : null;
  const finalMs = s?.endedAtMs ?? null;
  const crashMult = s?.crashE2 != null ? s.crashE2 / 100 : null;
  const displayMult = flying ? liveMult! : s?.status === 'cashed' ? s.cashedOutE2! / 100 : crashMult ?? 1;
  const rate = s?.growthPerMs ?? config.growthPerMs;
  const curveTo = flying ? elapsed : crashMult !== null ? Math.log(Math.min(crashMult, config.maxMultiplierE2 / 100)) / rate : 0;
  const spanMs = Math.max(8_000, Math.max(curveTo, finalMs ?? 0) * 1.12);
  const maxMult = Math.max(2, Math.exp(rate * spanMs) * 1.05);
  const cashX = s?.status === 'cashed' && s.endedAtMs != null ? 40 + ((W - 60) * s.endedAtMs) / spanMs : null;
  const cashY = s?.status === 'cashed' ? H - 30 - ((H - 60) * (s.cashedOutE2! / 100 - 1)) / (maxMult - 1) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Multiplier curve">
              <defs>
                <linearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#c7a35b" stopOpacity="0.25" />
                  <stop offset="1" stopColor="#c7a35b" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1="40" x2={W - 20} y1={30 + (H - 60) * f} y2={30 + (H - 60) * f} stroke="#282a31" strokeWidth="1" />
              ))}
              <line x1="40" x2={W - 20} y1={H - 30} y2={H - 30} stroke="#353841" strokeWidth="1" />
              {curveTo > 0 && (
                <>
                  <path d={`${curvePath(rate, curveTo, spanMs, maxMult)}L${(40 + ((W - 60) * curveTo) / spanMs).toFixed(1)},${H - 30}L40,${H - 30}Z`} fill="url(#crash-fill)" />
                  <path d={curvePath(rate, curveTo, spanMs, maxMult)} fill="none" stroke={s?.status === 'busted' ? '#e06a62' : '#d9bb76'} strokeWidth="3" strokeLinecap="round" />
                </>
              )}
              {cashX !== null && cashY !== null && <circle cx={cashX} cy={cashY} r="6" fill="#63b98f" stroke="#141519" strokeWidth="2" />}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div
                data-testid="crash-multiplier"
                className={cn('num text-6xl font-light tracking-tight sm:text-7xl', s?.status === 'busted' ? 'text-negative' : s?.status === 'cashed' ? 'text-positive' : 'text-ink-100')}
                aria-live="off"
              >
                {displayMult.toFixed(2)}×
              </div>
              <div className="mt-2 text-sm text-ink-400" role="status">
                {flying
                  ? s!.autoCashoutE2
                    ? `Auto cash-out at ${(s!.autoCashoutE2 / 100).toFixed(2)}×`
                    : 'In flight — cash out any time'
                  : s?.status === 'busted'
                    ? `Crashed at ${crashMult!.toFixed(2)}×`
                    : s?.status === 'cashed'
                      ? `Cashed out at ${(s.cashedOutE2! / 100).toFixed(2)}× · crash point ${crashMult!.toFixed(2)}×`
                      : 'Place a wager to start a round'}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            {flying ? (
              <>
                <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-400">Stake</span>
                    <span className="num">{formatChips(s!.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-400">Cash-out value (approx.)</span>
                    <span className="num font-semibold text-ink-100">{formatChips(mulDivFloor(s!.amount, Math.floor(100 * (liveMult ?? 1)), 100))}</span>
                  </div>
                </div>
                <Button variant="primary" size="lg" block loading={busy} onClick={() => act(round!.id, { type: 'cashout' }, 'cash out')} data-testid="crash-cashout">
                  Cash out
                </Button>
                <p className="text-xs text-ink-500">The server clock decides: your cash-out counts at the moment the server receives it. Network delay can lower the multiplier you get.</p>
              </>
            ) : (
              <>
                <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy} />
                <Toggle label="Automatic cash-out" description="Cash out automatically when the multiplier reaches your target." checked={autoOn} onChange={setAutoOn} />
                {autoOn && (
                  <div>
                    <label htmlFor="auto-target" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                      Target multiplier
                    </label>
                    <input
                      id="auto-target"
                      inputMode="decimal"
                      value={autoText}
                      onChange={(e) => setAutoText(e.target.value)}
                      className="num h-11 w-full rounded-xl border border-ink-600 bg-ink-900 px-3.5 text-base font-semibold text-ink-100 focus:border-gold-500 focus:outline-none"
                    />
                    {autoValid && autoE2 && (
                      <p className="mt-1.5 text-xs text-ink-400">
                        Wins {(survivalAt(autoE2, config.houseEdgeBp) * 100).toFixed(2)}% of the time and pays {formatChips(mulDivFloor(stake, autoE2, 100))}.
                      </p>
                    )}
                  </div>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  block
                  loading={busy}
                  disabled={Boolean(problem)}
                  onClick={() => start(autoE2 ? { amount: stake, autoCashoutE2: autoE2 } : { amount: stake }, `${formatChips(stake)} chips${autoE2 ? `, auto ${(autoE2 / 100).toFixed(2)}×` : ''}`)}
                  data-testid="crash-start"
                >
                  {problem ?? 'Start round'}
                </Button>
                {round && round.status !== 'OPEN' && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
                {round && round.status !== 'OPEN' && (
                  <Button variant="ghost" size="sm" onClick={() => setRound(null)}>
                    Reset
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
          <CardHeader title="Provably fair" subtitle="The crash point was fixed by these inputs before take-off" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent rounds" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="crash" refreshKey={round?.status === 'OPEN' ? null : round?.id} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}
