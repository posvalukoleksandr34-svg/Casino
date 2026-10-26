'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { useSession } from '../layout/session-provider';

export interface RoundView<S = unknown> {
  id: string;
  gameId: string;
  status: 'OPEN' | 'SETTLED' | 'VOIDED';
  stake: number;
  payout: number | null;
  maxPayout: number;
  startedAt: string;
  settledAt: string | null;
  actionCount: number;
  state: S;
  fairness: { serverSeedHash: string; clientSeed: string; nonce: number; serverSeed: string | null };
}

interface RoundResponse<S> {
  round: RoundView<S>;
  balance: number;
}

interface PendingRequest {
  kind: 'start' | 'act';
  key: string;
  path: string;
  body: unknown;
  description: string;
  at: number;
}

const storageKey = (gameId: string) => `aurovane:pending:${gameId}`;

function readPending(gameId: string): PendingRequest | null {
  try {
    const raw = sessionStorage.getItem(storageKey(gameId));
    return raw ? (JSON.parse(raw) as PendingRequest) : null;
  } catch {
    return null;
  }
}

function writePending(gameId: string, p: PendingRequest | null) {
  try {
    if (p) sessionStorage.setItem(storageKey(gameId), JSON.stringify(p));
    else sessionStorage.removeItem(storageKey(gameId));
  } catch {
    /* storage unavailable: recovery prompt is simply not offered */
  }
}

/**
 * Round lifecycle for a game screen: start/act requests with idempotency
 * keys, automatic safe retries, interrupted-request recovery and balance
 * synchronisation. The server response is always the source of truth.
 */
export function useRound<S>(gameId: string, opts: { deferBalance?: boolean } = {}) {
  const { setBalance, refresh } = useSession();
  const [round, setRound] = useState<RoundView<S> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [pendingBalance, setPendingBalance] = useState<number | null>(null);

  useEffect(() => {
    setPending(readPending(gameId));
  }, [gameId]);

  const send = useCallback(
    async (req: PendingRequest): Promise<RoundResponse<S> | null> => {
      setBusy(true);
      setError(null);
      writePending(gameId, req);
      try {
        const res = await api<RoundResponse<S>>(req.path, { method: 'POST', body: req.body, idempotencyKey: req.key, retries: 3 });
        writePending(gameId, null);
        setPending(null);
        setRound(res.round);
        if (opts.deferBalance && res.round.status === 'SETTLED') setPendingBalance(res.balance);
        else setBalance(res.balance);
        return res;
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : new ApiError('UNKNOWN', 'Unexpected error', 0);
        // Definitive server answers clear the pending record; network failures keep it for recovery.
        if (apiErr.code !== 'NETWORK_ERROR') writePending(gameId, null);
        else setPending(req);
        setError(apiErr);
        if (apiErr.code === 'INSUFFICIENT_FUNDS' || apiErr.code === 'CONFLICT') void refresh();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [gameId, opts.deferBalance, refresh, setBalance],
  );

  const start = useCallback(
    (bet: unknown, description: string) =>
      send({ kind: 'start', key: newIdempotencyKey(), path: `/api/games/${gameId}/rounds`, body: { bet }, description, at: Date.now() }),
    [gameId, send],
  );

  const act = useCallback(
    (roundId: string, action: unknown, description: string) =>
      send({ kind: 'act', key: newIdempotencyKey(), path: `/api/rounds/${roundId}/actions`, body: { action }, description, at: Date.now() }),
    [send],
  );

  const retryPending = useCallback(() => (pending ? send(pending) : Promise.resolve(null)), [pending, send]);
  const discardPending = useCallback(() => {
    writePending(gameId, null);
    setPending(null);
  }, [gameId]);

  /** Applies a balance deferred until an animation finished. */
  const commitBalance = useCallback(() => {
    if (pendingBalance !== null) {
      setBalance(pendingBalance);
      setPendingBalance(null);
    }
  }, [pendingBalance, setBalance]);

  const loadActive = useCallback(async () => {
    const res = await api<{ rounds: RoundView<S>[] }>('/api/rounds/active').catch(() => null);
    const mine = res?.rounds.find((r) => r.gameId === gameId) ?? null;
    if (mine) setRound(mine);
    return mine;
  }, [gameId]);

  return { round, setRound, busy, error, setError, start, act, pending, retryPending, discardPending, commitBalance, loadActive };
}
