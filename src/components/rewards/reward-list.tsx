'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatChips } from '@/engine/money';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '../layout/session-provider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Callout, EmptyState } from '../ui/misc';
import { useToast } from '../ui/toast';

export interface RewardView {
  id: number;
  kind: string;
  kindLabel: string;
  amount: number;
  description: string;
  status: 'AVAILABLE' | 'CLAIMED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
}

export function RewardList({ rewards, blocker }: { rewards: RewardView[]; blocker: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const { setBalance } = useSession();
  const [busy, setBusy] = useState<number | null>(null);
  async function claim(r: RewardView) {
    setBusy(r.id);
    try {
      const res = await api<{ amount: number; balance: number }>(`/api/rewards/${r.id}/claim`, { method: 'POST', body: {} });
      setBalance(res.balance);
      toast.push({ tone: 'positive', title: `${formatChips(res.amount)} credits added`, body: r.kindLabel });
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Not claimed', body: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }
  if (rewards.length === 0) {
    return (
      <EmptyState title="No rewards yet">
        Weekly cashback (from the Silver tier), a birthday reward, VIP level-up rewards and tournament prizes appear here when you earn them.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      {blocker && <Callout tone="warning">{blocker}</Callout>}
      <ul className="divide-y divide-white/[0.06]" data-testid="reward-list">
        {rewards.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink-100">{r.kindLabel}</span>
                {r.status === 'CLAIMED' ? <Badge tone="positive">Claimed</Badge> : r.status === 'EXPIRED' ? <Badge>Expired</Badge> : <Badge tone="gold">Ready</Badge>}
              </span>
              <span className="block text-sm text-ink-300">{r.description}</span>
              <span className="block text-xs text-ink-400">
                {r.status === 'CLAIMED' && r.claimedAt ? `Claimed ${new Date(r.claimedAt).toLocaleString()}` : `Claim by ${new Date(r.expiresAt).toLocaleDateString()}`} · no wagering
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="num text-lg font-semibold text-gold-200">{formatChips(r.amount)}</span>
              {r.status === 'AVAILABLE' && (
                <Button variant="primary" size="sm" loading={busy === r.id} disabled={busy !== null || Boolean(blocker)} onClick={() => claim(r)} data-testid="claim-reward">
                  Claim
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
