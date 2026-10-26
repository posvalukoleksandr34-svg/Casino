'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { StatusBadge } from '../ui/badge';
import { Select } from '../ui/form';
import { Callout, Chips, EmptyState } from '../ui/misc';
import { Table, Td, Th, Tr } from '../ui/table';
import { summarizeRound } from '../games/summaries';
import { GAME_NAMES } from './labels';

interface Item {
  id: string;
  gameId: string;
  status: string;
  stake: number;
  payout: number | null;
  startedAt: string;
  summary: unknown;
}

export function HistoryTable({ games }: { games: string[] }) {
  const [game, setGame] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before: string | null, reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ limit: '25' });
        if (game) q.set('game', game);
        if (before) q.set('before', before);
        const res = await api<{ items: Item[]; nextCursor: string | null }>(`/api/rounds?${q}`);
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.nextCursor);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [game],
  );

  useEffect(() => {
    void load(null, true);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label htmlFor="hist-game" className="text-sm text-ink-400">
          Game
        </label>
        <Select id="hist-game" value={game} onChange={(e) => setGame(e.target.value)} className="w-56">
          <option value="">All games</option>
          {games.map((g) => (
            <option key={g} value={g}>
              {GAME_NAMES[g] ?? g}
            </option>
          ))}
        </Select>
      </div>
      {error && <Callout tone="negative">{error}</Callout>}
      {!loading && items.length === 0 ? (
        <EmptyState title="No rounds yet" action={<Link href="/lobby" className="text-sm text-gold-400">Go to the lobby →</Link>}>
          Every round you play is recorded here with its fairness data.
        </EmptyState>
      ) : (
        <Table data-testid="history-table">
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Game</Th>
              <Th>Outcome</Th>
              <Th>Status</Th>
              <Th className="text-right">Stake</Th>
              <Th className="text-right">Payout</Th>
              <Th className="text-right">Net</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-ink-400">
                  <Link href={`/history/${r.id}`} className="hover:text-gold-300">
                    {new Date(r.startedAt).toLocaleString()}
                  </Link>
                </Td>
                <Td>{GAME_NAMES[r.gameId] ?? r.gameId}</Td>
                <Td>{summarizeRound(r.gameId, r.summary, r.status)}</Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td className="text-right">
                  <Chips amount={r.stake} suffix={false} />
                </Td>
                <Td className="text-right">{r.payout === null ? '—' : <Chips amount={r.payout} suffix={false} />}</Td>
                <Td className="text-right">{r.payout === null ? '—' : <Chips amount={r.payout - r.stake} sign colored suffix={false} />}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {cursor && (
        <div className="flex justify-center">
          <Button onClick={() => load(cursor, false)} loading={loading}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
