'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatChips } from '@/engine/money';
import { api, type ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '../ui/button';
import { Callout, Mono } from '../ui/misc';
import { summarizeRound } from './summaries';
import type { RoundView } from './use-round';

interface HistoryItem {
  id: string;
  gameId: string;
  status: string;
  stake: number;
  payout: number | null;
  startedAt: string;
  summary: unknown;
}

export function RecentRounds({ gameId, refreshKey }: { gameId: string; refreshKey: unknown }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ items: HistoryItem[] }>(`/api/rounds?game=${gameId}&limit=10`)
      .then((r) => !cancelled && setItems(r.items))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [gameId, refreshKey]);

  if (items === null) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>;
  if (items.length === 0) return <p className="text-sm text-ink-400">No rounds yet. Your recent results will appear here.</p>;
  return (
    <ul className="divide-y divide-ink-800" aria-label="Recent rounds">
      {items.map((r) => {
        const net = r.payout === null ? null : r.payout - r.stake;
        return (
          <li key={r.id}>
            <Link href={`/history/${r.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-ink-850/60">
              <div className="min-w-0">
                <div className="truncate text-ink-200">{summarizeRound(r.gameId, r.summary, r.status)}</div>
                <div className="text-xs text-ink-500">{new Date(r.startedAt).toLocaleTimeString()}</div>
              </div>
              <div className="text-right">
                <div className="num text-xs text-ink-400">stake {formatChips(r.stake)}</div>
                <div className={cn('num font-semibold', net === null ? 'text-ink-400' : net > 0 ? 'text-positive' : net < 0 ? 'text-ink-300' : 'text-ink-200')}>
                  {net === null ? r.status.toLowerCase() : formatChips(net, { sign: true })}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function FairnessStrip({ round }: { round: RoundView | null }) {
  if (!round) {
    return (
      <p className="text-xs text-ink-500">
        Each result is derived from your committed server seed, client seed and nonce. <Link href="/fairness" className="text-gold-400">How to verify</Link>
      </p>
    );
  }
  return (
    <dl className="grid gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <dt className="text-ink-500">Server seed hash</dt>
        <dd>
          <Mono>{round.fairness.serverSeedHash.slice(0, 24)}…</Mono>
        </dd>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <dt className="text-ink-500">Client seed</dt>
          <dd>
            <Mono>{round.fairness.clientSeed}</Mono>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-ink-500">Nonce</dt>
          <dd>
            <Mono>{round.fairness.nonce}</Mono>
          </dd>
        </div>
        <Link href={`/history/${round.id}`} className="text-gold-400 hover:text-gold-300">
          Round details →
        </Link>
      </div>
    </dl>
  );
}

const HINTS: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Lower your stake or claim daily chips in your wallet.',
  RISK_LIMIT: 'This wager exceeds a table limit. Try a smaller stake or lower potential payout.',
  RESPONSIBLE_GAMING: 'This limit was set by you. You can review it under Responsible play.',
  GAME_UNAVAILABLE: 'The game is paused. Any open round can still be completed.',
  RATE_LIMITED: 'Please slow down a little.',
  UNAUTHENTICATED: 'Your session has ended. Please sign in again.',
};

export function RoundError({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <Callout tone={error.code === 'NETWORK_ERROR' ? 'warning' : 'negative'} title={error.message} role="alert">
      {HINTS[error.code] ?? (error.requestId ? `Reference: ${error.requestId}` : null)}
      {error.code === 'RESPONSIBLE_GAMING' && (
        <>
          {' '}
          <Link href="/responsible-play" className="text-gold-400">
            Responsible play settings
          </Link>
        </>
      )}
      {error.code === 'UNAUTHENTICATED' && (
        <>
          {' '}
          <Link href="/login" className="text-gold-400">
            Sign in
          </Link>
        </>
      )}
    </Callout>
  );
}

export function PendingRecovery({
  pending,
  onRetry,
  onDiscard,
  busy,
}: {
  pending: { description: string; at: number } | null;
  onRetry: () => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  if (!pending) return null;
  return (
    <Callout tone="warning" title="A request may not have completed">
      <p>
        We lost the connection while sending: <strong>{pending.description}</strong> ({new Date(pending.at).toLocaleTimeString()}). Retrying
        is safe: it reuses the same request ID, so the server either returns the original result or performs it exactly once.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" onClick={onRetry} loading={busy}>
          Retry safely
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>
          Discard
        </Button>
      </div>
    </Callout>
  );
}

/** Neutral result line: shows gross return and net change without celebratory framing of losses. */
export function ResultLine({ stake, payout }: { stake: number; payout: number }) {
  const net = payout - stake;
  const tone = net > 0 ? 'text-positive' : net < 0 ? 'text-ink-300' : 'text-ink-200';
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2" role="status" aria-live="polite">
      <div className="text-sm text-ink-400">
        Returned <span className="num font-semibold text-ink-100">{formatChips(payout)}</span> of <span className="num">{formatChips(stake)}</span> staked
      </div>
      <div className={cn('num text-lg font-semibold', tone)}>{net === 0 ? '±0.00' : formatChips(net, { sign: true })}</div>
    </div>
  );
}
