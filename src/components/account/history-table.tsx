'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { StatusBadge } from '../ui/badge';
import { Input, Select } from '../ui/form';
import { parseChips } from '@/engine/money';
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

type Filters = { game: string; from: string; to: string; minStake: string; maxStake: string; minPayout: string; result: string; round: string };
const EMPTY: Filters = { game: '', from: '', to: '', minStake: '', maxStake: '', minPayout: '', result: '', round: '' };

function toMinor(v: string): string | null {
  if (!v.trim()) return null;
  try {
    return String(parseChips(v));
  } catch {
    return null;
  }
}

export function HistoryTable({ games }: { games: string[] }) {
  // Applied filters drive the query; the form edits a draft until "Apply".
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = Object.values(filters).some(Boolean);

  const load = useCallback(
    async (before: string | null, reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ limit: '25' });
        if (filters.game) q.set('game', filters.game);
        if (filters.from) q.set('from', filters.from);
        if (filters.to) q.set('to', filters.to);
        for (const k of ['minStake', 'maxStake', 'minPayout'] as const) {
          const v = toMinor(filters[k]);
          if (v !== null) q.set(k, v);
        }
        if (filters.result) q.set('result', filters.result);
        if (filters.round.trim()) q.set('round', filters.round.trim());
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
    [filters],
  );

  useEffect(() => {
    void load(null, true);
  }, [load]);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const label = 'mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-ink-300';
  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
        data-testid="history-filters"
      >
        <div>
          <label htmlFor="hist-game" className={label}>
            Game
          </label>
          <Select id="hist-game" value={draft.game} onChange={set('game')}>
            <option value="">All games</option>
            {games.map((g) => (
              <option key={g} value={g}>
                {GAME_NAMES[g] ?? g}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="hist-result" className={label}>
            Result
          </label>
          <Select id="hist-result" value={draft.result} onChange={set('result')}>
            <option value="">Any result</option>
            <option value="win">Won (paid more than the stake)</option>
            <option value="loss">Lost</option>
            <option value="push">Stake returned</option>
          </Select>
        </div>
        <div>
          <label htmlFor="hist-from" className={label}>
            From (UTC)
          </label>
          <Input id="hist-from" type="date" value={draft.from} onChange={set('from')} />
        </div>
        <div>
          <label htmlFor="hist-to" className={label}>
            To (UTC)
          </label>
          <Input id="hist-to" type="date" value={draft.to} onChange={set('to')} />
        </div>
        <div>
          <label htmlFor="hist-min-stake" className={label}>
            Stake from
          </label>
          <Input id="hist-min-stake" inputMode="decimal" placeholder="0.00" value={draft.minStake} onChange={set('minStake')} />
        </div>
        <div>
          <label htmlFor="hist-max-stake" className={label}>
            Stake up to
          </label>
          <Input id="hist-max-stake" inputMode="decimal" placeholder="Any" value={draft.maxStake} onChange={set('maxStake')} />
        </div>
        <div>
          <label htmlFor="hist-min-payout" className={label}>
            Payout from
          </label>
          <Input id="hist-min-payout" inputMode="decimal" placeholder="0.00" value={draft.minPayout} onChange={set('minPayout')} />
        </div>
        <div>
          <label htmlFor="hist-round" className={label}>
            Round ID
          </label>
          <Input id="hist-round" placeholder="Paste a round ID" value={draft.round} onChange={set('round')} spellCheck={false} />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary" size="sm" data-testid="history-apply">
            Apply filters
          </Button>
          {active && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY);
                setFilters(EMPTY);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </form>
      {error && <Callout tone="negative">{error}</Callout>}
      {!loading && items.length === 0 ? (
        active ? (
          <EmptyState title="No rounds match these filters" />
        ) : (
          <EmptyState title="No rounds yet" action={<Link href="/lobby" className="text-sm text-gold-400">Go to the lobby →</Link>}>
            Every round you play is recorded here with its fairness data.
          </EmptyState>
        )
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
              <Th>Round ID</Th>
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
                <Td className="font-mono text-[11px] text-ink-400">
                  <Link href={`/history/${r.id}`} className="hover:text-gold-300" title={r.id}>
                    {r.id.slice(0, 8)}
                  </Link>
                </Td>
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
