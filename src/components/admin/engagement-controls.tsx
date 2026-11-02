'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input, Select, Textarea } from '../ui/form';
import { Callout } from '../ui/misc';
import { useToast } from '../ui/toast';
import { ReasonedAction } from './reasoned-action';

const toMinor = (v: string) => Math.round(Number(v) * 100);
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Creates a tournament. Prizes are entered in credits, highest first; the server validates everything. */
export function CreateTournament({ games }: { games: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const now = new Date();
  const [f, setF] = useState({
    slug: '',
    name: '',
    description: '',
    metric: 'BEST_MULTIPLIER',
    minStake: '1',
    minVipLevel: '1',
    startsAt: localInput(now),
    endsAt: localInput(new Date(now.getTime() + 7 * 86_400_000)),
    prizes: '500, 250, 100',
    reason: '',
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/tournaments', {
        method: 'POST',
        body: {
          reason: f.reason,
          tournament: {
            slug: f.slug,
            name: f.name,
            description: f.description,
            gameIds: picked,
            metric: f.metric,
            minStake: toMinor(f.minStake),
            minVipLevel: Number(f.minVipLevel),
            startsAt: new Date(f.startsAt).toISOString(),
            endsAt: new Date(f.endsAt).toISOString(),
            prizes: f.prizes
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
              .map(toMinor),
          },
        },
      });
      toast.push({ tone: 'positive', title: 'Tournament created', body: 'Recorded in the audit log.' });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="create-tournament">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Slug">{(p) => <Input {...p} value={f.slug} onChange={set('slug')} placeholder="weekend-cup" />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={set('name')} />}</Field>
        <Field label="Ranking">
          {(p) => (
            <Select {...p} value={f.metric} onChange={set('metric')}>
              <option value="BEST_MULTIPLIER">Best single-round multiplier</option>
              <option value="TOP3_MULTIPLIERS">Sum of the three best multipliers</option>
            </Select>
          )}
        </Field>
        <Field label="Starts">{(p) => <Input {...p} type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />}</Field>
        <Field label="Ends">{(p) => <Input {...p} type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />}</Field>
        <Field label="Minimum stake (credits)">{(p) => <Input {...p} inputMode="decimal" value={f.minStake} onChange={set('minStake')} />}</Field>
        <Field label="Minimum VIP level (1 = everyone)">{(p) => <Input {...p} inputMode="numeric" value={f.minVipLevel} onChange={set('minVipLevel')} />}</Field>
        <Field label="Prizes by place (credits, comma-separated)" className="sm:col-span-2">
          {(p) => <Input {...p} value={f.prizes} onChange={set('prizes')} />}
        </Field>
      </div>
      <Field label="Description">{(p) => <Textarea {...p} value={f.description} onChange={set('description')} maxLength={600} rows={2} />}</Field>
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-ink-300">Games (none ticked = every game)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-200">
          {games.map((g) => (
            <label key={g.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={picked.includes(g.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, g.id] : x.filter((y) => y !== g.id)))} className="accent-[var(--color-gold-500)]" />
              {g.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Reason (stored in the audit log)">{(p) => <Input {...p} value={f.reason} onChange={set('reason')} />}</Field>
      {error && <Callout tone="negative" role="alert">{error}</Callout>}
      <Button type="submit" variant="primary" loading={busy} disabled={f.reason.trim().length < 5}>
        Create tournament
      </Button>
    </form>
  );
}

export function CancelTournament({ id }: { id: number }) {
  return (
    <ReasonedAction
      label="Cancel"
      title="Cancel the tournament"
      description="No prizes are paid. Entrants are notified with your reason."
      path={`/api/admin/tournaments/${id}/cancel`}
      body={(reason) => ({ reason })}
      variant="danger"
    />
  );
}

/** Creates an announcement or homepage banner (content:manage). Plain text only. */
export function CreateAnnouncement() {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ title: '', body: '', link: '', tone: 'info', placement: 'HOME', endsAt: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/content', {
        method: 'POST',
        body: {
          reason: f.reason,
          announcement: { title: f.title, body: f.body, link: f.link || null, tone: f.tone, placement: f.placement, ...(f.endsAt ? { endsAt: new Date(f.endsAt).toISOString() } : {}) },
        },
      });
      toast.push({ tone: 'positive', title: 'Announcement published' });
      setF((x) => ({ ...x, title: '', body: '', link: '', reason: '' }));
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="create-announcement">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={set('title')} maxLength={80} />}</Field>
        <Field label="Link (optional, e.g. /promotions)">{(p) => <Input {...p} value={f.link} onChange={set('link')} />}</Field>
      </div>
      <Field label="Text">{(p) => <Textarea {...p} value={f.body} onChange={set('body')} maxLength={300} rows={2} />}</Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Style">
          {(p) => (
            <Select {...p} value={f.tone} onChange={set('tone')}>
              <option value="info">Information</option>
              <option value="promo">Promotion</option>
              <option value="warning">Warning</option>
            </Select>
          )}
        </Field>
        <Field label="Where">
          {(p) => (
            <Select {...p} value={f.placement} onChange={set('placement')}>
              <option value="HOME">Home page</option>
              <option value="LOBBY">Lobby</option>
              <option value="ALL">Home and lobby</option>
            </Select>
          )}
        </Field>
        <Field label="Ends (optional)">{(p) => <Input {...p} type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />}</Field>
      </div>
      <Field label="Reason (stored in the audit log)">{(p) => <Input {...p} value={f.reason} onChange={set('reason')} />}</Field>
      {error && <Callout tone="negative" role="alert">{error}</Callout>}
      <Button type="submit" variant="primary" loading={busy} disabled={f.reason.trim().length < 5}>
        Publish
      </Button>
    </form>
  );
}

export function ToggleAnnouncement({ id, active }: { id: number; active: boolean }) {
  return (
    <ReasonedAction
      label={active ? 'Unpublish' : 'Publish'}
      title={active ? 'Unpublish the announcement' : 'Publish the announcement'}
      path={`/api/admin/content/${id}`}
      method="PATCH"
      body={(reason) => ({ patch: { active: !active }, reason })}
      variant={active ? 'danger' : 'secondary'}
    />
  );
}

type RewardSettings = { birthdayAmount: number; cashbackMinLoss: number; cashbackMax: number; rewardExpiryDays: number };

export function RewardSettingsForm({ settings }: { settings: RewardSettings }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({
    birthdayAmount: (settings.birthdayAmount / 100).toFixed(2),
    cashbackMinLoss: (settings.cashbackMinLoss / 100).toFixed(2),
    cashbackMax: (settings.cashbackMax / 100).toFixed(2),
    rewardExpiryDays: String(settings.rewardExpiryDays),
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, number> = {};
    for (const k of ['birthdayAmount', 'cashbackMinLoss', 'cashbackMax'] as const) if (toMinor(f[k]) !== settings[k]) patch[k] = toMinor(f[k]);
    if (Number(f.rewardExpiryDays) !== settings.rewardExpiryDays) patch.rewardExpiryDays = Number(f.rewardExpiryDays);
    if (!Object.keys(patch).length) return toast.push({ tone: 'info', title: 'Nothing changed' });
    setBusy(true);
    try {
      await api('/api/admin/rewards', { method: 'PATCH', body: { patch, reason: f.reason } });
      toast.push({ tone: 'positive', title: 'Reward rules saved', body: 'Recorded in the audit log.' });
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Not saved', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6" data-testid="reward-settings">
      <Field label="Birthday reward">{(p) => <Input {...p} inputMode="decimal" value={f.birthdayAmount} onChange={set('birthdayAmount')} />}</Field>
      <Field label="Cashback from net loss of">{(p) => <Input {...p} inputMode="decimal" value={f.cashbackMinLoss} onChange={set('cashbackMinLoss')} />}</Field>
      <Field label="Cashback cap">{(p) => <Input {...p} inputMode="decimal" value={f.cashbackMax} onChange={set('cashbackMax')} />}</Field>
      <Field label="Claim within (days)">{(p) => <Input {...p} inputMode="numeric" value={f.rewardExpiryDays} onChange={set('rewardExpiryDays')} />}</Field>
      <Field label="Reason">{(p) => <Input {...p} value={f.reason} onChange={set('reason')} />}</Field>
      <Button type="submit" variant="primary" loading={busy} disabled={f.reason.trim().length < 5}>
        Save
      </Button>
    </form>
  );
}
