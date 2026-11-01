'use client';

import { useEffect, useRef, useState } from 'react';
import { plinkoKey, plinkoRtp, plinkoSlotProbability, PLINKO_RISKS, PLINKO_ROWS, type PlinkoConfig, type PlinkoRisk, type PlinkoRows, type PlinkoState } from '@/engine/games/plinko';
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

const S = 10; // horizontal peg spacing (SVG units)
const H = 9; // vertical row spacing
const TOP = 8;

/** Bucket colour by payout: hot (red) at the edges, cool amber in the middle. */
function slotTone(m: number): string {
  if (m >= 1000) return 'bg-[#e0484a] text-white';
  if (m >= 300) return 'bg-[#f0683a] text-[#1a0a02]';
  if (m >= 150) return 'bg-[#ff9330] text-[#1a0a02]';
  if (m >= 100) return 'bg-[#ffbe4a] text-[#1a0a02]';
  return 'bg-[#6b4a22] text-[#ffe2b0]';
}

const compact = (e2: number) => {
  const x = e2 / 100;
  return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
};

/** Ball position (SVG units) after `t` rows of the stored path, with a small bounce between pegs. */
function ballAt(path: number[], t: number, rows: number) {
  const i = Math.min(Math.floor(t), rows);
  const frac = t - i;
  const rightsBefore = path.slice(0, i).reduce((a, b) => a + b, 0);
  const x0 = (rightsBefore - i / 2) * S;
  const dir = i < rows ? (path[i] ? 1 : -1) : 0;
  const x = x0 + dir * (S / 2) * frac;
  const y = TOP + (i + frac) * H - Math.sin(Math.PI * frac) * 2.5;
  return { x, y };
}

export function PlinkoGame({ config, limits, status }: { config: PlinkoConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const reduced = useReducedMotion();
  const { round, busy, error, start, pending, retryPending, discardPending, commitBalance } = useRound<PlinkoState>('plinko', { deferBalance: true });
  const audio = useGameAudio('plinko');
  const [stake, setStake] = useState(1_000);
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<PlinkoRisk>('medium');
  const [t, setT] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(true);
  const anim = useRef<number | null>(null);

  const last = round?.state ?? null;
  // While a ball is on the board, show its own table; otherwise the selection.
  const boardRows = last && !revealed ? last.rows : rows;
  const boardRisk = last && !revealed ? last.risk : risk;
  const table = config.tables[plinkoKey(boardRows, boardRisk)]!;
  const maxPayout = mulDivFloor(stake, Math.max(...config.tables[plinkoKey(rows, risk)]!), 100);

  const problem = !user
    ? 'Sign in to play'
    : status !== 'ACTIVE'
      ? 'Game paused'
      : (stakeProblem(stake, limits.minStake, limits.maxStake, balance) ?? (maxPayout > limits.maxPayoutPerRound ? 'Potential payout above table limit — lower the stake' : null));

  // Replays the server's stored path; the landing slot was decided before this runs.
  useEffect(() => {
    if (!round) return;
    if (anim.current) cancelAnimationFrame(anim.current);
    const R = round.state.rows;
    const landed = () => {
      audio.play('slot');
      if ((round.payout ?? 0) > round.stake) audio.play('win');
    };
    if (reduced) {
      setT(R);
      setRevealed(true);
      commitBalance();
      landed();
      return;
    }
    setRevealed(false);
    audio.play('drop');
    const perRow = R <= 8 ? 120 : R <= 12 ? 95 : 75;
    const t0 = performance.now();
    let row = 0;
    const step = (now: number) => {
      const v = Math.min(R, (now - t0) / perRow);
      setT(v);
      // A peg tick each time the ball reaches the next row (pitch varies a little).
      if (Math.floor(v) > row && v < R) {
        row = Math.floor(v);
        audio.play('peg', { rate: 0.9 + ((round.state.path[row - 1] ?? 0) ? 0.08 : 0) + (row % 4) * 0.03 });
      }
      if (v < R) anim.current = requestAnimationFrame(step);
      else {
        setRevealed(true);
        commitBalance();
        landed();
      }
    };
    anim.current = requestAnimationFrame(step);
    return () => {
      if (anim.current) cancelAnimationFrame(anim.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  const width = (boardRows + 2) * S;
  const height = TOP + boardRows * H + 4;
  const ball = last && t !== null && last.rows === boardRows ? ballAt(last.path, t, last.rows) : null;
  const landed = last && revealed && last.rows === boardRows && last.risk === boardRisk ? last.slot : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden bg-[radial-gradient(ellipse_70%_55%_at_50%_0%,rgb(255_170_70/0.16),transparent_70%),linear-gradient(180deg,rgb(40_22_6/0.85),rgb(14_8_2/0.92))]">
          <CardBody className="py-6">
            <svg viewBox={`${-width / 2} 0 ${width} ${height}`} className="mx-auto w-full max-w-xl" role="img" aria-label={`Plinko board with ${boardRows} rows`}>
              <defs>
                <radialGradient id="plinko-peg" cx="35%" cy="30%" r="70%">
                  <stop offset="0" stopColor="#fff6e6" />
                  <stop offset="1" stopColor="#c99a5a" />
                </radialGradient>
                <radialGradient id="plinko-ball-fill" cx="35%" cy="30%" r="70%">
                  <stop offset="0" stopColor="#fff3d6" />
                  <stop offset="0.55" stopColor="#ffb547" />
                  <stop offset="1" stopColor="#c46a12" />
                </radialGradient>
              </defs>
              {Array.from({ length: boardRows }, (_, i) =>
                Array.from({ length: i + 3 }, (_, j) => <circle key={`${i}-${j}`} cx={(j - 1 - i / 2) * S} cy={TOP + i * H + H / 2} r={1.25} fill="url(#plinko-peg)" />),
              )}
              {ball && (
                <g>
                  <circle cx={ball.x} cy={ball.y + H / 2 - 3} r={6} fill="#ffa53a" opacity={0.22} aria-hidden="true" />
                  <circle cx={ball.x} cy={ball.y + H / 2 - 3} r={2.7} fill="url(#plinko-ball-fill)" stroke="#fff1d0" strokeWidth={0.4} data-testid="plinko-ball" />
                </g>
              )}
            </svg>
            <div className="mx-auto mt-2 grid w-full max-w-xl gap-0.5" style={{ gridTemplateColumns: `repeat(${boardRows + 1}, minmax(0, 1fr))`, paddingInline: `${(100 / (boardRows + 2)) * 0.5}%` }}>
              {table.map((m, k) => (
                <div
                  key={k}
                  title={`Slot ${k}: ${(m / 100).toFixed(2)}×, chance ${(plinkoSlotProbability(boardRows, k) * 100).toPrecision(3)}%`}
                  className={cn(
                    'num rounded-md py-1 text-center text-[9px] font-bold leading-tight shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_3px_0_rgb(0_0_0/0.35)] transition-transform duration-200 sm:text-[11px]',
                    slotTone(m),
                    landed === k && 'animate-slot-hit ring-2 ring-white/90',
                  )}
                >
                  {compact(m)}
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-sm text-ink-400" aria-live="polite" data-testid="plinko-outcome">
              {last && revealed ? `Landed in slot ${last.slot} of 0–${last.rows}: ${(last.multiplierE2 / 100).toFixed(2)}×` : last ? 'Dropping…' : 'Choose rows and risk, then drop a ball.'}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy || !revealed} />
            <Segmented label="Rows" options={PLINKO_ROWS.map((r) => ({ value: r, label: String(r) }))} value={rows} onChange={(v) => setRows(v as PlinkoRows)} disabled={!revealed} />
            <Segmented label="Risk" options={PLINKO_RISKS.map((r) => ({ value: r, label: r[0]!.toUpperCase() + r.slice(1) }))} value={risk} onChange={(v) => setRisk(v as PlinkoRisk)} disabled={!revealed} />
            <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900/70 p-3.5 text-sm">
              <Row label="Top multiplier" value={`${(Math.max(...config.tables[plinkoKey(rows, risk)]!) / 100).toFixed(2)}×`} />
              <Row label="Chance of an edge slot" value={`1 in ${(2 ** rows / 2).toLocaleString('en-US')}`} />
              <Row label="Theoretical RTP" value={`${(plinkoRtp(rows, config.tables[plinkoKey(rows, risk)]!) * 100).toFixed(3)}%`} />
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              loading={busy || !revealed}
              disabled={Boolean(problem) || !revealed}
              onClick={() => start({ amount: stake, rows, risk }, `${formatChips(stake)} chips, plinko ${rows} rows ${risk}`)}
              data-testid="plinko-drop"
            >
              {problem ?? 'Drop ball'}
            </Button>
            {round && revealed && round.payout !== null && <ResultLine stake={round.stake} payout={round.payout} />}
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="The ball's whole path was fixed by these inputs before it was shown" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent drops" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId="plinko" refreshKey={revealed ? round?.id : null} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({ label, options, value, onChange, disabled }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">{label}</div>
      <div className="grid gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn('h-9 rounded-lg text-sm font-medium transition-colors disabled:opacity-60', value === o.value ? 'bg-ink-700 text-gold-200' : 'text-ink-400 hover:text-ink-200')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-400">{label}</span>
      <span className="num text-ink-200">{value}</span>
    </div>
  );
}
