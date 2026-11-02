'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input, Select } from '../ui/form';
import { Callout } from '../ui/misc';
import { useToast } from '../ui/toast';
import { ReasonedAction } from './reasoned-action';

export function KycDecision({ userId }: { userId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ReasonedAction
        label="Verify identity"
        title="Verify this player's identity"
        description="Only after checking that the documents are genuine, readable, current and match the profile (name, date of birth, address). The note is shown to the player."
        path={`/api/admin/kyc/${userId}/decision`}
        body={(note) => ({ decision: 'VERIFIED', note })}
        variant="primary"
        confirm="I have checked every document against the profile."
      />
      <ReasonedAction
        label="Reject"
        title="Reject the submission"
        description="Say exactly what is wrong so the player can fix it (e.g. 'The proof of address is older than three months'). The note is shown to the player."
        path={`/api/admin/kyc/${userId}/decision`}
        body={(note) => ({ decision: 'REJECTED', note })}
        variant="danger"
      />
    </div>
  );
}

const FLAG_KINDS: [string, string][] = [
  ['DOCUMENT_MISMATCH', 'Document mismatch'],
  ['MULTIPLE_ACCOUNTS', 'Possible multiple accounts'],
  ['PAYMENT_CHARGEBACK', 'Payment chargeback'],
  ['BONUS_ABUSE', 'Bonus abuse'],
  ['SOURCE_OF_FUNDS', 'Source of funds'],
  ['OTHER', 'Other'],
];

export function AddRiskFlag({ userId }: { userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [kind, setKind] = useState('OTHER');
  const [severity, setSeverity] = useState('MEDIUM');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/kyc/${userId}/flags`, { method: 'POST', body: { kind, severity, note } });
      toast.push({ tone: 'info', title: 'Flag added', body: 'Withdrawals of this account now go to manual review. Recorded in the audit log.' });
      setNote('');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
              {FLAG_KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Severity">
          {(p) => (
            <Select {...p} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Note (stored in the audit log; not shown to the player)">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
      {error && <Callout tone="negative">{error}</Callout>}
      <Button type="submit" variant="secondary" loading={busy} disabled={note.trim().length < 5}>
        Add flag
      </Button>
    </form>
  );
}

export function ResolveRiskFlag({ flagId }: { flagId: number }) {
  return (
    <ReasonedAction label="Resolve" title="Resolve the risk flag" description="Explain why the concern no longer applies." path={`/api/admin/risk-flags/${flagId}/resolve`} body={(resolution) => ({ resolution })} />
  );
}

export function TicketStaffActions({ id, status, assigned }: { id: string; status: string; assigned: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {!assigned && (
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/admin/support/${id}/assign`, { method: 'POST', body: {} });
              router.refresh();
            } catch (err) {
              toast.push({ tone: 'negative', title: 'Not assigned', body: errorMessage(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Assign to me
        </Button>
      )}
      {status !== 'RESOLVED' && (
        <ReasonedAction label="Mark resolved" title="Mark the ticket resolved" description="The player is notified and can still reply." path={`/api/admin/support/${id}/status`} body={(reason) => ({ status: 'RESOLVED', reason })} />
      )}
      <ReasonedAction label="Close" title="Close the ticket" description="A closed ticket takes no further replies." path={`/api/admin/support/${id}/status`} body={(reason) => ({ status: 'CLOSED', reason })} variant="danger" />
    </div>
  );
}

type Tier = { level: number; name: string; minWagered: number; topUpBonusPct: number; prioritySupport: boolean; cashbackBp: number; levelUpReward: number };

export function VipTierForm({ tier }: { tier: Tier }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(tier.name);
  const [min, setMin] = useState((tier.minWagered / 100).toFixed(2));
  const [pct, setPct] = useState(String(tier.topUpBonusPct));
  const [priority, setPriority] = useState(tier.prioritySupport);
  const [cashback, setCashback] = useState((tier.cashbackBp / 100).toFixed(2));
  const [levelUp, setLevelUp] = useState((tier.levelUpReward / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    if (name !== tier.name) patch.name = name;
    if (Math.round(Number(min) * 100) !== tier.minWagered) patch.minWagered = Math.round(Number(min) * 100);
    if (Number(pct) !== tier.topUpBonusPct) patch.topUpBonusPct = Number(pct);
    if (priority !== tier.prioritySupport) patch.prioritySupport = priority;
    if (Math.round(Number(cashback) * 100) !== tier.cashbackBp) patch.cashbackBp = Math.round(Number(cashback) * 100);
    if (Math.round(Number(levelUp) * 100) !== tier.levelUpReward) patch.levelUpReward = Math.round(Number(levelUp) * 100);
    if (!Object.keys(patch).length) return toast.push({ tone: 'info', title: 'Nothing changed' });
    setBusy(true);
    try {
      await api(`/api/admin/vip/${tier.level}`, { method: 'PATCH', body: { patch, reason } });
      toast.push({ tone: 'positive', title: `${name} saved`, body: 'Recorded in the audit log.' });
      setReason('');
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Not saved', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="From wagered">{(p) => <Input {...p} inputMode="decimal" value={min} disabled={tier.level === 1} onChange={(e) => setMin(e.target.value)} />}</Field>
      <Field label="Top-up bonus %">{(p) => <Input {...p} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} />}</Field>
      <Field label="Weekly cashback %">{(p) => <Input {...p} inputMode="decimal" value={cashback} onChange={(e) => setCashback(e.target.value)} />}</Field>
      <Field label="Level-up reward">{(p) => <Input {...p} inputMode="decimal" value={levelUp} onChange={(e) => setLevelUp(e.target.value)} />}</Field>
      <label className="flex h-11 items-center gap-2 text-sm text-ink-200">
        <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} className="accent-[var(--color-gold-500)]" />
        Priority support
      </label>
      <Field label="Reason">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <Button type="submit" variant="primary" loading={busy} disabled={reason.trim().length < 5}>
        Save
      </Button>
    </form>
  );
}
