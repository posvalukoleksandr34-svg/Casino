'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { SLOT_REELS, SLOT_ROWS, type SlotConfig, type SlotSpin, type SlotState } from '@/engine/games/slots/engine';
import { formatChips } from '@/engine/money';
import { cn } from '@/lib/cn';
import { useSession } from '../../layout/session-provider';
import { Card, CardBody, CardHeader } from '../../ui/card';
import { FairnessStrip, PendingRecovery, RecentRounds, RoundError } from '../round-panels';
import { StakeInput, stakeProblem } from '../stake-input';
import { useGameAudio } from '../use-game-audio';
import { useReducedMotion } from '../use-reduced-motion';
import { useRound } from '../use-round';
import { SymbolArt, type SlotTheme } from './symbol-art';

interface ThemeLook {
  /** Stage background behind the reels. */
  stage: string;
  /** Reel window background. */
  reels: string;
  /** Frame colour around the reels. */
  frame: string;
  /** Title gradient. */
  title: string;
  /** Title outline. */
  titleStroke: string;
  /** Accent for messages. */
  accent: string;
  scenery: React.ReactNode;
}

const LOOKS: Record<SlotTheme, ThemeLook> = {
  'lantern-hollow': {
    stage: 'radial-gradient(120% 80% at 50% 0%, #4a3a9a 0%, #23185a 40%, #0d0824 100%)',
    reels: 'linear-gradient(180deg, #2b1a55, #1a0f38 50%, #2b1a55)',
    frame: 'linear-gradient(180deg, #8a7ad0, #3a2a6b 40%, #241650)',
    title: 'linear-gradient(180deg, #fff3b0, #ffb347 55%, #c2410c)',
    titleStroke: '#2a0f45',
    accent: '#ffcf7a',
    scenery: (
      <svg viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" className="absolute inset-x-0 bottom-0 h-28 w-full opacity-70" aria-hidden="true">
        <circle cx="330" cy="34" r="22" fill="#fff4cf" opacity="0.85" />
        <path d="M0 120 v-30 l20 -6 l12 -26 l8 22 l18 -8 l10 18 l30 -4 l14 -30 l10 30 l40 6 l20 -20 l16 22 l50 -6 l12 -34 l10 34 l40 2 l18 -16 l22 20 l50 -8 v42z" fill="#0b0620" />
        <path d="M60 50 q6 -6 10 0 q4 -6 10 0 q-6 -2 -10 4 q-4 -6 -10 -4z M250 30 q5 -5 8 0 q3 -5 8 0 q-5 -1.5 -8 3 q-3 -4.5 -8 -3z" fill="#0b0620" />
      </svg>
    ),
  },
  'ember-fruits': {
    stage: 'radial-gradient(120% 80% at 50% 0%, #b8341a 0%, #5a1208 45%, #1a0402 100%)',
    reels: 'linear-gradient(180deg, #3a0c08, #220504 50%, #3a0c08)',
    frame: 'linear-gradient(180deg, #ffe08a, #c2841c 40%, #6a3a08)',
    title: 'linear-gradient(180deg, #fffbe0, #ffd34d 45%, #ff6a1a)',
    titleStroke: '#4a0a02',
    accent: '#ffd34d',
    scenery: (
      <svg viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" className="absolute inset-x-0 bottom-0 h-28 w-full opacity-60" aria-hidden="true">
        {Array.from({ length: 22 }, (_, i) => (
          <circle key={i} cx={(i * 53) % 400} cy={30 + ((i * 37) % 80)} r={1 + (i % 3)} fill="#ffb347" opacity={0.3 + (i % 4) * 0.15} />
        ))}
        <path d="M0 120 c40 -30 60 -10 90 -26 c30 -16 50 6 80 -10 c30 -16 60 8 90 -6 c30 -14 60 4 80 -12 c20 -16 40 0 60 -6 v60z" fill="#3a0a04" />
      </svg>
    ),
  },
  'sands-of-aurum': {
    stage: 'radial-gradient(120% 80% at 50% 0%, #2b6aa8 0%, #12305a 45%, #07142a 100%)',
    reels: 'linear-gradient(180deg, #0f2a4a, #081a33 50%, #0f2a4a)',
    frame: 'linear-gradient(180deg, #ffe7a3, #c8952c 40%, #6a4510)',
    title: 'linear-gradient(180deg, #fffbe6, #f2c95b 50%, #a8701c)',
    titleStroke: '#0c2340',
    accent: '#f2c95b',
    scenery: (
      <svg viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" className="absolute inset-x-0 bottom-0 h-28 w-full opacity-75" aria-hidden="true">
        <circle cx="70" cy="40" r="20" fill="#ffd977" opacity="0.8" />
        <path d="M230 120 l60 -78 l60 78z" fill="#7a5214" />
        <path d="M290 42 l60 78 h-30z" fill="#4a3008" />
        <path d="M150 120 l36 -46 l36 46z" fill="#8a6018" />
        <path d="M0 120 c60 -22 120 -10 180 -16 c80 -8 140 4 220 -10 v26z" fill="#c08a2c" />
      </svg>
    ),
  },
};

/** Spin timing (ms) before the turbo / skip factor. */
const TIMING = { firstStop: 900, stagger: 260, winShow: 1400, fsIntro: 2000, fsStop: 650, fsStagger: 150, fsWinShow: 900, bigWin: 3200 };

const WIN_TIERS: [number, string][] = [
  [5000, 'EPIC WIN'],
  [2500, 'MEGA WIN'],
  [1000, 'BIG WIN'],
];

type Phase = 'idle' | 'spinning' | 'wins' | 'fs-intro' | 'fs' | 'big-win' | 'done';

interface Shown {
  spin: SlotSpin;
  /** Animation id: changes on every spin so the reels restart. */
  id: string;
  /** Per-reel stop times (ms after start). */
  stopsAt: number[];
}

export function SlotGame({ gameId, config, limits, status }: { gameId: SlotTheme; config: SlotConfig; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number }; status: string }) {
  const { user, balance } = useSession();
  const reduced = useReducedMotion();
  const look = LOOKS[gameId];
  const names = new Map(config.symbols.map((s) => [s.id, s.name]));
  const { round, busy, error, start, pending, retryPending, discardPending, commitBalance } = useRound<SlotState>(gameId, { deferBalance: true });
  const audio = useGameAudio('slots');
  const [stake, setStake] = useState(100);
  const [turbo, setTurbo] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [shown, setShown] = useState<Shown | null>(null);
  const [previous, setPrevious] = useState<string[][]>(() => config.reels.map((strip) => strip.slice(0, SLOT_ROWS)));
  const [highlight, setHighlight] = useState(false);
  const [freeInfo, setFreeInfo] = useState<{ index: number; count: number; totalE2: number } | null>(null);
  const [winE2, setWinE2] = useState(0);
  const [bigWin, setBigWin] = useState<{ label: string; e2: number } | null>(null);
  const speed = useRef(1);
  const wake = useRef<(() => void) | null>(null);

  const busyPlaying = phase !== 'idle' && phase !== 'done';
  const problem = !user ? 'Sign in to play' : status !== 'ACTIVE' ? 'Game paused' : stakeProblem(stake, limits.minStake, limits.maxStake, balance);

  /** Sleep that the skip button (speed 0) cuts short. */
  const sleep = useCallback((ms: number, ctl: { cancelled: boolean }) => {
    return new Promise<void>((resolve) => {
      if (ctl.cancelled || speed.current === 0) return resolve();
      const t = setTimeout(done, ms * speed.current);
      function done() {
        clearTimeout(t);
        if (wake.current === done) wake.current = null;
        resolve();
      }
      wake.current = done;
    });
  }, []);

  // Presentation of a settled round: base spin, wins, free spins, big win. The outcome is the server's.
  useEffect(() => {
    if (!round) return;
    const s = round.state;
    const ctl = { cancelled: false };
    speed.current = reduced ? 0 : turbo ? 0.45 : 1;

    const animateSpin = async (spin: SlotSpin, id: string, first: number, stagger: number) => {
      const f = speed.current;
      const stopsAt = Array.from({ length: SLOT_REELS }, (_, i) => Math.round((first + i * stagger) * f));
      setHighlight(false);
      setShown({ spin, id, stopsAt });
      if (f > 0) {
        audio.startLoop('spin');
        stopsAt.forEach((t, i) =>
          setTimeout(() => {
            if (ctl.cancelled) return;
            audio.play('stop', { rate: 0.95 + i * 0.03 });
            if (spin.grid[i]!.some((sym) => config.symbols.find((x) => x.id === sym)?.kind === 'scatter')) audio.play('scatter');
            if (i === SLOT_REELS - 1) audio.stopLoop('spin');
          }, t),
        );
      }
      await sleep(stopsAt[SLOT_REELS - 1]! / Math.max(f, 1e-9) + 120, ctl);
      audio.stopLoop('spin');
      setPrevious(spin.grid);
    };

    const run = async () => {
      setBigWin(null);
      setFreeInfo(null);
      setWinE2(0);
      setPhase('spinning');
      await animateSpin(s.base, `${round.id}-base`, TIMING.firstStop, TIMING.stagger);
      if (ctl.cancelled) return;
      let running = s.base.winE2;
      setWinE2(running);
      if (s.base.winE2 > 0) {
        setPhase('wins');
        setHighlight(true);
        audio.play('win');
        await sleep(TIMING.winShow, ctl);
      }
      if (s.freeSpins.length > 0) {
        setPhase('fs-intro');
        audio.play('free-spins');
        setFreeInfo({ index: 0, count: s.freeSpins.length, totalE2: running });
        await sleep(TIMING.fsIntro, ctl);
        for (const [k, fs] of s.freeSpins.entries()) {
          if (ctl.cancelled) return;
          setPhase('fs');
          setFreeInfo({ index: k + 1, count: s.freeSpins.length, totalE2: running });
          await animateSpin(fs, `${round.id}-fs-${k}`, TIMING.fsStop, TIMING.fsStagger);
          running += fs.winE2;
          setWinE2(running);
          setFreeInfo({ index: k + 1, count: s.freeSpins.length, totalE2: running });
          if (fs.winE2 > 0) {
            setHighlight(true);
            audio.play('win', { rate: 1.05 });
            await sleep(TIMING.fsWinShow, ctl);
          }
        }
      }
      if (ctl.cancelled) return;
      const tier = WIN_TIERS.find(([min]) => s.totalE2 >= min);
      if (tier) {
        setPhase('big-win');
        setBigWin({ label: tier[1], e2: s.totalE2 });
        audio.play('big-win');
        await sleep(TIMING.bigWin, ctl);
      }
      if (ctl.cancelled) return;
      setPhase('done');
      commitBalance();
    };
    void run();
    return () => {
      ctl.cancelled = true;
      wake.current?.();
      audio.stopLoop('spin');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  const spin = () => {
    if (problem || busy || busyPlaying) return;
    setPhase('spinning');
    void start({ amount: stake }, `${formatChips(stake)} chips, spin`).then((r) => {
      if (!r) setPhase((p) => (p === 'spinning' ? 'idle' : p));
    });
  };

  const skip = () => {
    speed.current = 0;
    setShown((s) => (s ? { ...s, stopsAt: s.stopsAt.map(() => 0) } : s));
    wake.current?.();
  };

  const stakeAmount = round?.stake ?? stake;
  const winChips = Math.floor((stakeAmount * winE2) / 100);
  const s = round?.state;
  const message =
    phase === 'idle'
      ? 'Place your stake and spin'
      : phase === 'spinning'
        ? 'Good luck!'
        : phase === 'fs-intro'
          ? `${freeInfo?.count} FREE SPINS · every win ×${config.freeSpins.multiplier}`
          : phase === 'fs'
            ? `Free spin ${freeInfo?.index} of ${freeInfo?.count}`
            : winE2 > 0
              ? `WIN ${formatChips(winChips)}`
              : 'No win this time';

  const winList = highlight && shown ? shown.spin.wins : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div
          className="relative overflow-hidden rounded-[1.75rem] border border-white/10 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)]"
          style={{ backgroundImage: look.stage }}
          data-testid="slot-stage"
          data-phase={phase}
          onClick={busyPlaying && phase !== 'spinning' ? skip : undefined}
        >
          {look.scenery}
          <div className="relative px-3 pb-5 pt-5 sm:px-6">
            <h2
              className="text-center font-display text-3xl font-black uppercase tracking-wide sm:text-4xl"
              style={{ backgroundImage: look.title, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextStroke: `1.5px ${look.titleStroke}`, filter: 'drop-shadow(0 4px 6px rgb(0 0 0 / 0.6))' }}
            >
              {gameId === 'lantern-hollow' ? 'Lantern Hollow' : gameId === 'ember-fruits' ? 'Ember Fruits' : 'Sands of Aurum'}
            </h2>
            <div className="mx-auto mt-3 max-w-[600px] rounded-2xl p-[6px] shadow-[0_10px_30px_-10px_rgb(0_0_0/0.8)]" style={{ backgroundImage: look.frame }}>
              <Reels theme={gameId} config={config} shown={shown} previous={previous} highlight={highlight} reduced={reduced} />
            </div>
            <div className="mx-auto mt-3 flex min-h-11 max-w-[600px] items-center justify-center rounded-xl bg-black/35 px-4 py-2 text-center backdrop-blur-sm" aria-live="polite" data-testid="slot-message">
              <span className={cn('font-display text-lg font-bold uppercase tracking-wider sm:text-xl', winE2 > 0 && (phase === 'wins' || phase === 'done' || phase === 'big-win') ? 'text-white' : 'text-white/90')} style={winE2 > 0 ? { color: look.accent, textShadow: `0 0 18px ${look.accent}` } : undefined}>
                {message}
              </span>
            </div>
            {freeInfo && (phase === 'fs' || phase === 'fs-intro') && (
              <div className="mt-2 text-center text-sm font-semibold text-white/90" data-testid="slot-free-spins">
                Free spins win so far: <span className="num">{formatChips(Math.floor((stakeAmount * freeInfo.totalE2) / 100))}</span>
              </div>
            )}
          </div>
          {phase === 'fs-intro' && freeInfo && (
            <Overlay>
              <div className="text-sm font-semibold uppercase tracking-[0.3em] text-white/80">Bonus</div>
              <div className="font-display text-5xl font-black uppercase sm:text-6xl" style={{ backgroundImage: look.title, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                {freeInfo.count} free spins
              </div>
              <div className="mt-1 text-white/85">Every win ×{config.freeSpins.multiplier}</div>
            </Overlay>
          )}
          {bigWin && phase === 'big-win' && (
            <Overlay>
              <div className="animate-glow-pulse font-display text-6xl font-black uppercase sm:text-7xl" style={{ backgroundImage: look.title, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: `drop-shadow(0 0 24px ${look.accent})` }} data-testid="slot-big-win">
                {bigWin.label}
              </div>
              <div className="num mt-2 text-3xl font-semibold text-white">{formatChips(Math.floor((stakeAmount * bigWin.e2) / 100))}</div>
              <div className="text-sm text-white/75">{(bigWin.e2 / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}× your stake</div>
            </Overlay>
          )}
          {busyPlaying && phase !== 'spinning' && !reduced && (
            <button type="button" onClick={skip} className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-xs text-white/85 backdrop-blur-sm hover:bg-black/60">
              Skip
            </button>
          )}
        </div>

        <Card>
          <CardBody className="space-y-5">
            <StakeInput value={stake} onChange={setStake} min={limits.minStake} max={limits.maxStake} balance={balance} disabled={busy || busyPlaying} />
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setTurbo((t) => !t)}
                aria-pressed={turbo}
                className={cn('grid size-12 place-items-center rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors', turbo ? 'border-gold-400 bg-gold-500/20 text-gold-200' : 'border-white/15 bg-white/[0.05] text-ink-300 hover:text-ink-100')}
                title="Turbo: faster reels (same results)"
                data-testid="slot-turbo"
              >
                Turbo
              </button>
              <button
                type="button"
                onClick={spin}
                disabled={Boolean(problem) || busy || busyPlaying}
                aria-label={problem ?? `Spin for ${formatChips(stake)} chips`}
                className="group relative grid size-24 place-items-center rounded-full border-4 border-gold-300/70 bg-[radial-gradient(circle_at_35%_30%,#fff3c4,#f2c95b_45%,#a8701c)] text-ink-950 shadow-[0_12px_30px_-8px_rgb(199_163_91/0.8),inset_0_2px_0_rgb(255_255_255/0.6)] transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-[radial-gradient(circle_at_35%_30%,#4a4b52,#26272d)] disabled:text-ink-400 disabled:shadow-none disabled:hover:scale-100"
                data-testid="slot-spin"
              >
                <svg viewBox="0 0 24 24" className={cn('size-10', (busy || busyPlaying) && !reduced && 'animate-spin')} aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="w-12 text-center text-[10px] uppercase tracking-wider text-ink-400">
                Win
                <div className="num text-sm font-semibold text-ink-100" data-testid="slot-win">
                  {phase === 'done' || phase === 'wins' || phase === 'fs' || phase === 'big-win' ? formatChips(winChips) : '—'}
                </div>
              </div>
            </div>
            {problem && <p className="text-center text-sm text-ink-300">{problem}</p>}
            {winList.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs" aria-label="Wins on this spin">
                {winList.map((w) => (
                  <li key={w.symbol} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-ink-200">
                      <SymbolArt theme={gameId} symbol={w.symbol} className="size-6" />
                      {names.get(w.symbol)} · {w.reels} reels · {w.ways} way{w.ways === 1 ? '' : 's'}
                    </span>
                    <span className="num text-gold-200">{(w.winE2 / 100).toFixed(2)}×</span>
                  </li>
                ))}
              </ul>
            )}
            {phase === 'done' && round && s && (
              <p className="text-center text-sm text-ink-300" data-testid="slot-result">
                {s.totalE2 > 0 ? `Returned ${formatChips(round.payout ?? 0)} of ${formatChips(round.stake)} staked` : `No win · ${formatChips(round.stake)} staked`}
                {s.freeSpins.length > 0 && ` · ${s.freeSpins.length} free spins`}
              </p>
            )}
            <p className="text-center text-[11px] leading-relaxed text-ink-400">
              One stake per spin. No autoplay and no buying of free spins: every spin is your own decision. Turbo only shortens the animation.
            </p>
            <RoundError error={error} />
            <PendingRecovery pending={pending} onRetry={retryPending} onDiscard={discardPending} busy={busy} />
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Provably fair" subtitle="Every reel stop, free spins included, comes from these inputs" />
          <CardBody>
            <FairnessStrip round={round} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your recent spins" />
          <CardBody className="pt-2">{user ? <RecentRounds gameId={gameId} refreshKey={phase === 'done' ? round?.id : null} /> : <p className="text-sm text-ink-400">Sign in to see your history.</p>}</CardBody>
        </Card>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 z-20 grid place-items-center bg-black/55 text-center backdrop-blur-[2px] animate-fade-in">{<div className="px-6">{children}</div>}</div>;
}

/** Extra symbols scrolled before the stop, per reel (later reels spin longer). */
const RUN_IN = [14, 18, 22, 26, 30];

/**
 * Five reel windows. On each new spin a reel scrolls through its real strip
 * (from the previous result to the server's stop) and lands with a bounce.
 */
function Reels({ theme, config, shown, previous, highlight, reduced }: { theme: SlotTheme; config: SlotConfig; shown: Shown | null; previous: string[][]; highlight: boolean; reduced: boolean }) {
  const [go, setGo] = useState(false);
  const spinId = shown?.id;
  useEffect(() => {
    if (!spinId) return;
    setGo(false);
    // Two frames: lay out at the start position, then transition to the stop.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setGo(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [spinId]);

  const winning = new Set(highlight && shown ? shown.spin.wins.flatMap((w) => w.cells.map(([r, c]) => `${r}:${c}`)) : []);
  const scatterIds = new Set(config.symbols.filter((s) => s.kind === 'scatter').map((s) => s.id));

  return (
    <div
      className="grid grid-cols-5 gap-[3px] overflow-hidden rounded-xl"
      style={{ '--reel-bg': LOOKS[theme].reels, '--win-ring': LOOKS[theme].accent } as CSSProperties}
      data-testid="slot-reels" role="img" aria-label={shown ? `Reels: ${shown.spin.grid.map((col) => col.join(' ')).join(' / ')}` : 'Reels'}>
      {Array.from({ length: SLOT_REELS }, (_, i) => {
        const final = shown?.spin.grid[i] ?? previous[i]!;
        const strip = config.reels[i]!;
        const stop = shown?.spin.stops[i] ?? 0;
        const n = shown && !reduced ? RUN_IN[i]! : 0;
        // Top to bottom: the final window, then the strip after it, then the previous window at the bottom.
        const items = shown && n > 0 ? [...final, ...Array.from({ length: n - SLOT_ROWS }, (_, k) => strip[(stop + SLOT_ROWS + k) % strip.length]!), ...previous[i]!] : final;
        const total = items.length;
        const duration = shown?.stopsAt[i] ?? 0;
        const style: CSSProperties =
          shown && n > 0
            ? {
                transform: go ? 'translateY(0%)' : `translateY(-${((total - SLOT_ROWS) / total) * 100}%)`,
                transition: go && duration > 0 ? `transform ${duration}ms cubic-bezier(0.18, 0.75, 0.25, 1.06)` : 'none',
              }
            : {};
        return (
          <div key={i} className="relative aspect-[1/3.4] overflow-hidden" style={{ backgroundImage: 'linear-gradient(180deg, rgb(0 0 0 / 0.35), transparent 18%, transparent 82%, rgb(0 0 0 / 0.35))' }}>
            <div className="absolute inset-0" style={{ background: 'var(--reel-bg)' }} />
            <div className="absolute inset-x-0 top-0" style={{ height: `${(total / SLOT_ROWS) * 100}%`, ...style }}>
              {items.map((sym, k) => {
                const isFinal = k < SLOT_ROWS;
                const win = isFinal && winning.has(`${i}:${k}`);
                const dim = highlight && isFinal && winning.size > 0 && !win;
                return (
                  <div key={k} className="relative" style={{ height: `${100 / total}%` }}>
                    <div className={cn('absolute inset-[4%] grid place-items-center rounded-lg transition-[opacity,filter] duration-300', win && 'bg-white/10 ring-2 ring-[color:var(--win-ring)] [animation:slot-win_900ms_ease-in-out_infinite]', dim && 'opacity-35 saturate-50', scatterIds.has(sym) && isFinal && 'drop-shadow-[0_0_10px_rgb(255_230_150/0.7)]')}>
                      <SymbolArt theme={theme} symbol={sym} className="size-[88%]" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
