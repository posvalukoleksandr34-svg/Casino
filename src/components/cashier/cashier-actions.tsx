'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatChips } from '@/engine/money';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Callout } from '../ui/misc';
import { DEPOSIT_STATUS, type DepositView } from './types';

/** Cancels a deposit that has not been paid, or a withdrawal that has not been paid out. */
export function CancelButton({ kind, id }: { kind: 'deposit' | 'withdrawal'; id: string }) {
  const router = useRouter();
  const { setBalance } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/cashier/${kind === 'deposit' ? 'deposits' : 'withdrawals'}/${id}/cancel`, { method: 'POST', body: {} });
      if (kind === 'withdrawal') setBalance((await api<{ balance: number }>('/api/wallet')).balance);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" onClick={cancel} loading={busy} data-testid={`cancel-${kind}`}>
        Cancel
      </Button>
      {error && <span className="text-xs text-negative">{error}</span>}
    </span>
  );
}

const FINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNDER_REVIEW']);

/**
 * The page a player returns to from the checkout. It shows what the server
 * knows — the deposit's status — and refreshes it until the provider's
 * confirmation has been processed. It never infers success from the checkout.
 */
export function DepositStatus({ initial, unit }: { initial: DepositView; unit: string }) {
  const { setBalance } = useSession();
  const [d, setD] = useState(initial);
  const final = FINAL.has(d.status);
  useEffect(() => {
    if (final) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await api<{ deposit: DepositView }>(`/api/cashier/deposits/${d.id}`);
        if (stop) return;
        setD(res.deposit);
        if (res.deposit.status === 'COMPLETED') setBalance((await api<{ balance: number }>('/api/wallet')).balance);
      } catch {
        /* keep polling */
      }
    };
    const t = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [d.id, final, setBalance]);
  useEffect(() => {
    if (initial.status === 'COMPLETED') void api<{ balance: number }>('/api/wallet').then((w) => setBalance(w.balance)).catch(() => undefined);
  }, [initial.status, setBalance]);

  const s = DEPOSIT_STATUS[d.status] ?? { label: d.status, tone: 'info' as const };
  return (
    <div className="space-y-4" data-testid="deposit-status" data-status={d.status}>
      <Callout tone={s.tone} title={s.label} role="status">
        {d.status === 'COMPLETED' && `${formatChips(d.credited)} ${unit} have been added to your balance.`}
        {d.status === 'PENDING' && 'Waiting for the payment provider to confirm the payment. This page updates by itself.'}
        {d.status === 'CREATED' && 'The deposit is being set up.'}
        {d.status === 'FAILED' && (d.failureReason ?? 'The payment did not go through. No money was taken.')}
        {d.status === 'CANCELLED' && (d.failureReason ?? 'The payment was cancelled.')}
        {d.status === 'EXPIRED' && 'The payment was not completed in time. If money was taken, it will be credited when the provider confirms it.'}
        {d.status === 'UNDER_REVIEW' && 'The provider reported something we need to check (for example a different amount). Our finance team will resolve it; nothing is lost.'}
      </Callout>
    </div>
  );
}

/** The simulated provider's buttons. Each makes the simulator send its signed confirmation to the server. */
export function SandboxCheckoutActions({ depositId }: { depositId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(outcome: 'pay' | 'decline' | 'cancel') {
    setBusy(outcome);
    setError(null);
    try {
      await api(`/api/cashier/deposits/${depositId}/sandbox`, { method: 'POST', body: { outcome } });
      router.push(`/wallet/deposits/${depositId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => act('pay')} disabled={busy !== null} className="h-11 rounded-lg bg-[#1f6f4a] px-5 text-sm font-semibold text-white hover:bg-[#1a5e3f] disabled:opacity-60" data-testid="sandbox-pay">
          {busy === 'pay' ? 'Processing…' : 'Simulate successful payment'}
        </button>
        <button type="button" onClick={() => act('decline')} disabled={busy !== null} className="h-11 rounded-lg border border-[#b42318]/40 px-4 text-sm font-medium text-[#b42318] hover:bg-[#b42318]/5 disabled:opacity-60" data-testid="sandbox-decline">
          Simulate decline
        </button>
        <button type="button" onClick={() => act('cancel')} disabled={busy !== null} className="h-11 rounded-lg px-4 text-sm font-medium text-[#475467] hover:bg-black/5 disabled:opacity-60" data-testid="sandbox-cancel">
          Cancel and return
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[#b42318]">
          {error}
        </p>
      )}
    </div>
  );
}
