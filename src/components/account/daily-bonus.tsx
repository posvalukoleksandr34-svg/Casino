'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatChips } from '@/engine/money';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';

export function DailyBonus({
  amount,
  claimedToday,
  nextAvailableAt,
  maxBalance,
  blockedReason,
}: {
  amount: number;
  claimedToday: boolean;
  nextAvailableAt: string;
  maxBalance: number;
  blockedReason: string | null;
}) {
  const { balance, setBalance } = useSession();
  const toast = useToast();
  const [claimed, setClaimed] = useState(claimedToday);
  const [busy, setBusy] = useState(false);
  const eligible = !blockedReason && !claimed && balance < maxBalance && amount > 0;
  async function claim() {
    setBusy(true);
    try {
      const res = await api<{ amount: number; balance: number }>('/api/wallet/daily-bonus', { method: 'POST', body: {} });
      setBalance(res.balance);
      setClaimed(true);
      toast.push({ tone: 'positive', title: `${formatChips(res.amount)} chips added`, body: 'Daily chips have no monetary value.' });
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Could not claim daily chips', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="text-sm text-ink-300">
        {blockedReason ? (
          <>{blockedReason}</>
        ) : claimed ? (
          <>Claimed today. Next claim from {new Date(nextAvailableAt).toUTCString().slice(0, 22)} UTC.</>
        ) : balance >= maxBalance ? (
          <>Daily chips are available while your balance is below {formatChips(maxBalance)}.</>
        ) : (
          <>Top up {formatChips(amount)} chips once per day while your balance is below {formatChips(maxBalance)}.</>
        )}
      </div>
      <Button variant="primary" onClick={claim} loading={busy} disabled={!eligible}>
        Claim {formatChips(amount)} chips
      </Button>
    </div>
  );
}
