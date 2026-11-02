'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input, Textarea } from '../ui/form';
import { Callout } from '../ui/misc';
import { useToast } from '../ui/toast';
import { ReasonedAction } from './reasoned-action';

/** Approve / reject a withdrawal. The server enforces that the player and the first approver cannot decide it. */
export function WithdrawalReview({ id, needsTwo, firstApproved, amountLabel }: { id: string; needsTwo: boolean; firstApproved: boolean; amountLabel: string }) {
  return (
    <span className="inline-flex flex-wrap justify-end gap-1.5">
      <ReasonedAction
        label={needsTwo && !firstApproved ? 'Approve (1 of 2)' : 'Approve'}
        title={`Approve withdrawal of ${amountLabel}`}
        description={
          needsTwo && !firstApproved
            ? 'This amount needs two different approvers. Your approval is recorded; a second finance member must approve before the payout is sent.'
            : 'The payout is sent to the provider immediately.'
        }
        path={`/api/admin/payments/withdrawals/${id}/review`}
        body={(reason) => ({ decision: 'approve', note: reason })}
        variant="primary"
      />
      <ReasonedAction
        label="Reject"
        title={`Reject withdrawal of ${amountLabel}`}
        description="The full amount returns to the player's balance. The reason is shown to the player."
        path={`/api/admin/payments/withdrawals/${id}/review`}
        body={(reason) => ({ decision: 'reject', note: reason })}
        variant="danger"
      />
    </span>
  );
}

/** Sandbox only: make the simulated provider report a payout as paid or failed. */
export function SandboxPayoutButtons({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function settle(outcome: 'paid' | 'failed') {
    setBusy(outcome);
    try {
      const res = await api<{ result: string }>(`/api/admin/payments/withdrawals/${id}/sandbox`, { method: 'POST', body: { outcome } });
      toast.push({ tone: 'info', title: 'Sandbox provider notified', body: `Webhook result: ${res.result}` });
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Could not settle', body: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }
  return (
    <span className="inline-flex gap-1.5">
      <Button size="sm" variant="secondary" loading={busy === 'paid'} disabled={busy !== null} onClick={() => settle('paid')}>
        Simulate paid
      </Button>
      <Button size="sm" variant="ghost" loading={busy === 'failed'} disabled={busy !== null} onClick={() => settle('failed')}>
        Simulate failure
      </Button>
    </span>
  );
}

export function FailDeposit({ id }: { id: string }) {
  return (
    <ReasonedAction
      label="Close as failed"
      title="Close the deposit as failed"
      description="Use this when the provider's payment does not match the deposit. The wallet is not credited; refund the payment through the provider. The reason is shown to the player."
      path={`/api/admin/payments/deposits/${id}/fail`}
      body={(reason) => ({ reason })}
      variant="danger"
    />
  );
}

const toMinor = (v: string) => Math.round(Number(v) * 100);
const fromMinor = (v: number) => (v / 100).toFixed(2);

type Settings = {
  dailyDepositLimit: number;
  monthlyDepositLimit: number;
  depositExpiryMinutes: number;
  dailyWithdrawalLimit: number;
  monthlyWithdrawalLimit: number;
  withdrawalCooldownMinutes: number;
  reviewThreshold: number;
  dualApprovalThreshold: number;
  kycRequiredForWithdrawal: boolean;
  closedLoop: boolean;
};

const MONEY: [keyof Settings, string][] = [
  ['dailyDepositLimit', 'Daily deposit limit (site)'],
  ['monthlyDepositLimit', '30-day deposit limit (site)'],
  ['dailyWithdrawalLimit', 'Daily withdrawal limit'],
  ['monthlyWithdrawalLimit', '30-day withdrawal limit'],
  ['reviewThreshold', 'Manual review from (0 = all)'],
  ['dualApprovalThreshold', 'Two approvers from'],
];
const MINUTES: [keyof Settings, string][] = [
  ['depositExpiryMinutes', 'Unpaid deposit expires after (min)'],
  ['withdrawalCooldownMinutes', 'Minutes between withdrawals'],
];

/** Cashier rules (payments:configure). Changes are audited with a reason; amounts are entered in units, stored in minor units. */
export function CashierSettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<Record<string, string | boolean>>(() => ({
    ...Object.fromEntries(MONEY.map(([k]) => [k, fromMinor(settings[k] as number)])),
    ...Object.fromEntries(MINUTES.map(([k]) => [k, String(settings[k])])),
    kycRequiredForWithdrawal: settings.kycRequiredForWithdrawal,
    closedLoop: settings.closedLoop,
  }));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, number | boolean> = {};
    for (const [k] of MONEY) if (toMinor(f[k] as string) !== settings[k]) patch[k] = toMinor(f[k] as string);
    for (const [k] of MINUTES) if (Number(f[k]) !== settings[k]) patch[k] = Number(f[k]);
    for (const k of ['kycRequiredForWithdrawal', 'closedLoop'] as const) if (f[k] !== settings[k]) patch[k] = f[k] as boolean;
    if (Object.keys(patch).length === 0) return setError('Nothing changed.');
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/payments/settings', { method: 'PATCH', body: { patch, reason } });
      toast.push({ tone: 'positive', title: 'Cashier rules saved', body: 'Recorded in the audit log.' });
      setReason('');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-4" data-testid="cashier-settings">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...MONEY, ...MINUTES].map(([k, label]) => (
          <Field key={k} label={label}>
            {(p) => <Input {...p} inputMode="decimal" value={f[k] as string} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap gap-5 text-sm text-ink-200">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.kycRequiredForWithdrawal as boolean} onChange={(e) => setF((x) => ({ ...x, kycRequiredForWithdrawal: e.target.checked }))} className="accent-[var(--color-gold-500)]" />
          Identity verification required before the first withdrawal
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.closedLoop as boolean} onChange={(e) => setF((x) => ({ ...x, closedLoop: e.target.checked }))} className="accent-[var(--color-gold-500)]" />
          Closed loop: withdraw only to a method used for a completed deposit
        </label>
      </div>
      <Field label="Reason (required, stored in the audit log)">{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      {error && <Callout tone="negative" role="alert">{error}</Callout>}
      <Button type="submit" variant="primary" loading={busy} disabled={reason.trim().length < 5}>
        Save rules
      </Button>
    </form>
  );
}

type Method = {
  id: string;
  name: string;
  active: boolean;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  maxWithdrawal: number;
  depositFeeFixed: number;
  depositFeeBp: number;
  withdrawalFeeFixed: number;
  withdrawalFeeBp: number;
};

/** One payment method's availability, limits and fees (payments:configure). The provider is fixed in code. */
export function MethodForm({ method }: { method: Method }) {
  const router = useRouter();
  const toast = useToast();
  const money = ['minDeposit', 'maxDeposit', 'minWithdrawal', 'maxWithdrawal', 'depositFeeFixed', 'withdrawalFeeFixed'] as const;
  const bp = ['depositFeeBp', 'withdrawalFeeBp'] as const;
  const flags = ['active', 'depositEnabled', 'withdrawalEnabled'] as const;
  const [f, setF] = useState<Record<string, string | boolean>>(() => ({
    ...Object.fromEntries(money.map((k) => [k, fromMinor(method[k])])),
    ...Object.fromEntries(bp.map((k) => [k, String(method[k])])),
    ...Object.fromEntries(flags.map((k) => [k, method[k]])),
  }));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, number | boolean> = {};
    for (const k of money) if (toMinor(f[k] as string) !== method[k]) patch[k] = toMinor(f[k] as string);
    for (const k of bp) if (Number(f[k]) !== method[k]) patch[k] = Number(f[k]);
    for (const k of flags) if (f[k] !== method[k]) patch[k] = f[k] as boolean;
    if (Object.keys(patch).length === 0) return toast.push({ tone: 'info', title: 'Nothing changed' });
    setBusy(true);
    try {
      await api(`/api/admin/payments/methods/${method.id}`, { method: 'PATCH', body: { patch, reason } });
      toast.push({ tone: 'positive', title: `${method.name} saved`, body: 'Recorded in the audit log.' });
      setReason('');
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Not saved', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    minDeposit: 'Min deposit',
    maxDeposit: 'Max deposit',
    minWithdrawal: 'Min withdrawal',
    maxWithdrawal: 'Max withdrawal',
    depositFeeFixed: 'Deposit fee (fixed)',
    withdrawalFeeFixed: 'Withdrawal fee (fixed)',
    depositFeeBp: 'Deposit fee (basis points)',
    withdrawalFeeBp: 'Withdrawal fee (basis points)',
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[...money, ...bp].map((k) => (
          <Field key={k} label={labels[k]}>
            {(p) => <Input {...p} inputMode="decimal" value={f[k] as string} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap gap-5 text-sm text-ink-200">
        {flags.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={f[k] as boolean} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.checked }))} className="accent-[var(--color-gold-500)]" />
            {k === 'active' ? 'Active' : k === 'depositEnabled' ? 'Deposits' : 'Withdrawals'}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Reason" className="min-w-64 flex-1">
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
        </Field>
        <Button type="submit" variant="primary" loading={busy} disabled={reason.trim().length < 5}>
          Save method
        </Button>
      </div>
    </form>
  );
}
