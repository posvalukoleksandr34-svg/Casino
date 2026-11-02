'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input, Select, Textarea } from '../ui/form';
import { useToast } from '../ui/toast';

const chipsToMinor = (v: string) => Math.round(Number(v || '0') * 100);

/** Creates a campaign. Amounts are entered in credits and sent in minor units; the server validates everything. */
export function CreateCampaign() {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({
    kind: 'PROMO_CODE',
    slug: '',
    code: '',
    name: '',
    description: '',
    fixed: '1000',
    match: '0',
    max: '1000',
    wagering: '1',
    days: '14',
    age: '',
    maxClaims: '',
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/admin/promotions', {
        method: 'POST',
        body: {
          reason: f.reason,
          campaign: {
            kind: f.kind,
            slug: f.slug,
            code: f.kind === 'PROMO_CODE' ? f.code : null,
            name: f.name,
            description: f.description,
            fixedAmount: chipsToMinor(f.fixed),
            matchPercent: Number(f.match || '0'),
            maxBonus: chipsToMinor(f.max),
            wageringMultiplier: Number(f.wagering || '0'),
            expiresAfterDays: Number(f.days || '0'),
            eligibleAccountAgeDays: f.age ? Number(f.age) : null,
            maxClaims: f.maxClaims ? Number(f.maxClaims) : null,
          },
        },
      });
      toast.push({ tone: 'positive', title: 'Campaign created' });
      setF((x) => ({ ...x, slug: '', code: '', name: '', description: '', reason: '' }));
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Could not create the campaign', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" data-testid="create-campaign">
      <Field label="Type">
        {(p) => (
          <Select {...p} value={f.kind} onChange={set('kind')}>
            <option value="PROMO_CODE">Promo code</option>
            <option value="WELCOME">Welcome offer</option>
          </Select>
        )}
      </Field>
      <Field label="Slug" hint="Lower-case letters, digits, dashes">
        {(p) => <Input {...p} value={f.slug} onChange={set('slug')} required />}
      </Field>
      {f.kind === 'PROMO_CODE' && (
        <Field label="Code" hint="4–20 letters or digits">
          {(p) => <Input {...p} value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase() }))} required />}
        </Field>
      )}
      <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={set('name')} required />}</Field>
      <Field label="Description" className="sm:col-span-2">
        {(p) => <Textarea {...p} value={f.description} onChange={set('description')} rows={2} required />}
      </Field>
      <Field label="Fixed amount (credits)">{(p) => <Input {...p} inputMode="decimal" value={f.fixed} onChange={set('fixed')} />}</Field>
      <Field label="Match % of starting credits">{(p) => <Input {...p} inputMode="numeric" value={f.match} onChange={set('match')} />}</Field>
      <Field label="Maximum bonus (credits)">{(p) => <Input {...p} inputMode="decimal" value={f.max} onChange={set('max')} />}</Field>
      <Field label="Wagering multiple" hint="0 = released at once; at most 20">
        {(p) => <Input {...p} inputMode="numeric" value={f.wagering} onChange={set('wagering')} />}
      </Field>
      <Field label="Days to complete">{(p) => <Input {...p} inputMode="numeric" value={f.days} onChange={set('days')} />}</Field>
      <Field label="Only accounts up to N days old" hint="Empty = any age">
        {(p) => <Input {...p} inputMode="numeric" value={f.age} onChange={set('age')} />}
      </Field>
      <Field label="Total claim cap" hint="Empty = no cap">
        {(p) => <Input {...p} inputMode="numeric" value={f.maxClaims} onChange={set('maxClaims')} />}
      </Field>
      <Field label="Reason (audited)" className="sm:col-span-2">
        {(p) => <Input {...p} value={f.reason} onChange={set('reason')} required minLength={5} />}
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" loading={busy}>
          Create campaign
        </Button>
      </div>
    </form>
  );
}

/** Pause, resume or end a campaign now (audited with a reason). */
export function CampaignActions({ id, active, ended }: { id: number; active: boolean; ended: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function patch(p: Record<string, unknown>, label: string) {
    const reason = window.prompt(`${label}: reason (audited, at least 5 characters)`);
    if (!reason) return;
    setBusy(true);
    try {
      await api(`/api/admin/promotions/${id}`, { method: 'PATCH', body: { patch: p, reason } });
      toast.push({ tone: 'positive', title: `${label} done` });
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: `${label} failed`, body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  if (ended) return <span className="text-xs text-ink-400">Ended</span>;
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="secondary" loading={busy} onClick={() => patch({ active: !active }, active ? 'Pause' : 'Resume')}>
        {active ? 'Pause' : 'Resume'}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ endsAt: new Date(Date.now() + 1000).toISOString() }, 'End')}>
        End now
      </Button>
    </div>
  );
}
