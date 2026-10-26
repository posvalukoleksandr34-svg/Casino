'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Select } from '../ui/form';
import { Callout, Chips, EmptyState } from '../ui/misc';
import { Table, Td, Th, Tr } from '../ui/table';
import { TX_LABELS } from './labels';

interface Tx {
  entryId: number;
  transactionId: number;
  type: string;
  description: string;
  amount: number;
  balanceAfter: number | null;
  roundId: string | null;
  createdAt: string;
}

export function TransactionsTable() {
  const [type, setType] = useState('');
  const [items, setItems] = useState<Tx[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before: number | null, reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ limit: '50' });
        if (before) q.set('before', String(before));
        if (type) q.set('type', type);
        const res = await api<{ items: Tx[]; nextCursor: number | null }>(`/api/wallet/transactions?${q}`);
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.nextCursor);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [type],
  );

  useEffect(() => {
    void load(null, true);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="tx-type" className="text-sm text-ink-400">
          Type
        </label>
        <Select id="tx-type" value={type} onChange={(e) => setType(e.target.value)} className="w-48">
          <option value="">All</option>
          {['BET_PLACED', 'BET_SETTLED', 'BONUS_GRANTED', 'ROUND_VOIDED', 'ADJUSTMENT'].map((t) => (
            <option key={t} value={t}>
              {TX_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>
      {error && <Callout tone="negative">{error}</Callout>}
      {!loading && items.length === 0 ? (
        <EmptyState title="No transactions">Your wagers, payouts and bonuses will appear here.</EmptyState>
      ) : (
        <Table data-testid="transactions-table">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Description</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Balance after</Th>
              <Th className="text-right">Ref</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <Tr key={t.entryId}>
                <Td className="whitespace-nowrap text-ink-400">{new Date(t.createdAt).toLocaleString()}</Td>
                <Td>{TX_LABELS[t.type] ?? t.type}</Td>
                <Td>{t.roundId ? <Link href={`/history/${t.roundId}`} className="hover:text-gold-300">{t.description}</Link> : t.description}</Td>
                <Td className="text-right">
                  <Chips amount={t.amount} sign colored suffix={false} />
                </Td>
                <Td className="text-right">{t.balanceAfter !== null && <Chips amount={t.balanceAfter} suffix={false} />}</Td>
                <Td className="num text-right text-xs text-ink-500">#{t.transactionId}</Td>
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
