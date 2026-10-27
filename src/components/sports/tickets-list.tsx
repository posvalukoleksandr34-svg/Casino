'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { OUTCOME_LABELS } from '@/engine/sports/model';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { StatusBadge } from '../ui/badge';
import { Button } from '../ui/button';
import { Callout, Chips, EmptyState } from '../ui/misc';
import { Table, Td, Th, Tr } from '../ui/table';

interface Ticket {
  id: string;
  eventId: string;
  selectionCode: 'HOME' | 'DRAW' | 'AWAY';
  stake: number;
  oddsE2: number;
  potentialReturn: number;
  status: string;
  rejectReason: string | null;
  payout: number | null;
  isDemo: boolean;
  placedAt: string;
  settlementVersion: number | null;
}

const TABS = [
  { id: 'open', label: 'Open' },
  { id: 'settled', label: 'Settled' },
  { id: 'all', label: 'All' },
] as const;

export function TicketsList() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('open');
  const [items, setItems] = useState<Ticket[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (before: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ status: tab, limit: '25' });
        if (before) q.set('before', before);
        const res = await api<{ items: Ticket[]; nextCursor: string | null }>(`/api/sports/tickets?${q}`);
        setItems((prev) => (before ? [...(prev ?? []), ...res.items] : res.items));
        setCursor(res.nextCursor);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    setItems(null);
    void load(null);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="Prediction status">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('rounded-lg border px-3 py-1.5 text-sm', tab === t.id ? 'border-gold-500 text-gold-200' : 'border-ink-700 text-ink-300 hover:border-ink-500')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && (
        <Callout tone="negative" role="alert" title="Could not load your predictions">
          {error}{' '}
          <button type="button" className="text-gold-400 underline" onClick={() => void load(null)}>
            Try again
          </button>
        </Callout>
      )}
      {items === null && !error ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>
      ) : items && items.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'No open predictions' : 'No predictions yet'} action={<Link href="/sports" className="text-sm text-gold-400">Browse events →</Link>}>
          {tab === 'open' ? 'Predictions waiting for a result appear here.' : 'Your settled predictions appear here.'}
        </EmptyState>
      ) : items ? (
        <Table>
          <thead>
            <tr>
              <Th>Placed</Th>
              <Th>Pick</Th>
              <Th className="text-right">Odds</Th>
              <Th className="text-right">Stake</Th>
              <Th className="text-right">Returns if won</Th>
              <Th className="text-right">Returned</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody data-testid="tickets">
            {items.map((t) => (
              <Tr key={t.id}>
                <Td className="whitespace-nowrap text-ink-400">{new Date(t.placedAt).toLocaleString()}</Td>
                <Td>
                  <Link href={`/sports/events/${t.eventId}`} className="hover:text-gold-300">
                    {OUTCOME_LABELS[t.selectionCode]}
                  </Link>
                  {t.isDemo && <span className="ml-1 text-xs text-ink-400">(demo)</span>}
                </Td>
                <Td className="num text-right">{(t.oddsE2 / 100).toFixed(2)}</Td>
                <Td className="text-right">
                  <Chips amount={t.stake} suffix={false} />
                </Td>
                <Td className="text-right">
                  <Chips amount={t.potentialReturn} suffix={false} />
                </Td>
                <Td className="text-right">{t.payout === null ? '—' : <Chips amount={t.payout} suffix={false} />}</Td>
                <Td>
                  <StatusBadge status={t.status} />
                  {t.rejectReason && <div className="text-xs text-ink-400">{t.rejectReason}</div>}
                  {t.settlementVersion !== null && t.settlementVersion > 1 && <div className="text-xs text-ink-400">Result corrected (version {t.settlementVersion})</div>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {cursor && (
        <Button variant="secondary" size="sm" loading={loading} onClick={() => void load(cursor)}>
          Load more
        </Button>
      )}
    </div>
  );
}
