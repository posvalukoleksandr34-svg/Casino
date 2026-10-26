'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatChips, parseChips } from '@/engine/money';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Field, Input, Select } from '../ui/form';
import { Callout, Chips } from '../ui/misc';
import { Modal } from '../ui/modal';
import { useToast } from '../ui/toast';

type Limits = {
  dailyLossLimit: number | null;
  weeklyLossLimit: number | null;
  dailyWagerLimit: number | null;
  sessionLimitMinutes: number | null;
  realityCheckMinutes: number | null;
};

export interface ResponsibleData {
  limits: Limits;
  pending: Partial<Limits> | null;
  pendingEffectiveAt: string | null;
  coolOffUntil: string | null;
  selfExcludedUntil: string | null;
  usage: { wagered24h: number; netLoss24h: number; netLoss7d: number };
}

const MONEY_FIELDS: { key: 'dailyLossLimit' | 'weeklyLossLimit' | 'dailyWagerLimit'; label: string; usage: (u: ResponsibleData['usage']) => number }[] = [
  { key: 'dailyLossLimit', label: '24-hour loss limit', usage: (u) => Math.max(0, u.netLoss24h) },
  { key: 'weeklyLossLimit', label: '7-day loss limit', usage: (u) => Math.max(0, u.netLoss7d) },
  { key: 'dailyWagerLimit', label: '24-hour wagering limit', usage: (u) => u.wagered24h },
];

export function LimitsForm({ data }: { data: ResponsibleData }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => ({
    dailyLossLimit: data.limits.dailyLossLimit ? formatChips(data.limits.dailyLossLimit).replace(/,/g, '') : '',
    weeklyLossLimit: data.limits.weeklyLossLimit ? formatChips(data.limits.weeklyLossLimit).replace(/,/g, '') : '',
    dailyWagerLimit: data.limits.dailyWagerLimit ? formatChips(data.limits.dailyWagerLimit).replace(/,/g, '') : '',
    sessionLimitMinutes: data.limits.sessionLimitMinutes ? String(data.limits.sessionLimitMinutes) : '',
    realityCheckMinutes: data.limits.realityCheckMinutes ? String(data.limits.realityCheckMinutes) : '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, number | null> = {};
      for (const f of MONEY_FIELDS) body[f.key] = values[f.key] ? parseChips(values[f.key]!) : null;
      body.sessionLimitMinutes = values.sessionLimitMinutes ? Number(values.sessionLimitMinutes) : null;
      body.realityCheckMinutes = values.realityCheckMinutes ? Number(values.realityCheckMinutes) : null;
      const res = await api<{ applied: Record<string, unknown>; pending: Record<string, unknown> | null }>('/api/responsible', { method: 'PUT', body });
      toast.push({
        tone: 'positive',
        title: 'Limits saved',
        body: res.pending ? 'Stricter limits apply now; increases or removals take effect after 24 hours.' : 'Your limits apply immediately.',
      });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Limits" subtitle="Lower limits apply immediately. Raising or removing a limit takes effect after a 24-hour cooling-off period." />
      <CardBody className="space-y-6">
        <div className="grid gap-5 md:grid-cols-3">
          {MONEY_FIELDS.map((f) => {
            const limit = data.limits[f.key];
            const used = f.usage(data.usage);
            return (
              <Field key={f.key} label={f.label} hint={limit ? `Used ${formatChips(used)} of ${formatChips(limit)}` : 'No limit set'}>
                {(p) => (
                  <Input {...p} inputMode="decimal" placeholder="No limit" value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
              </Field>
            );
          })}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Session time limit" hint="Wagering stops once a login session lasts this long.">
            {(p) => (
              <Select {...p} value={values.sessionLimitMinutes} onChange={(e) => setValues((v) => ({ ...v, sessionLimitMinutes: e.target.value }))}>
                <option value="">No limit</option>
                {[15, 30, 60, 120, 240].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reality check" hint="A reminder showing time played and your 24-hour result.">
            {(p) => (
              <Select {...p} value={values.realityCheckMinutes} onChange={(e) => setValues((v) => ({ ...v, realityCheckMinutes: e.target.value }))}>
                <option value="">Off</option>
                {[15, 30, 60, 120].map((m) => (
                  <option key={m} value={m}>
                    Every {m} minutes
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {data.pending && data.pendingEffectiveAt && (
          <Callout tone="info" title="Pending changes">
            {Object.entries(data.pending)
              .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v === null ? 'removed' : k.includes('Minutes') ? `${v} min` : formatChips(v as number)}`)
              .join(' · ')}{' '}
            — effective {new Date(data.pendingEffectiveAt).toLocaleString()}.
          </Callout>
        )}
        {error && <Callout tone="negative">{error}</Callout>}
        <Button variant="primary" onClick={save} loading={busy}>
          Save limits
        </Button>
      </CardBody>
    </Card>
  );
}

export function BreakControls({ data }: { data: ResponsibleData }) {
  const router = useRouter();
  const toast = useToast();
  const [hours, setHours] = useState('24');
  const [months, setMonths] = useState('6');
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function coolOff() {
    setBusy(true);
    try {
      await api('/api/responsible/cool-off', { method: 'POST', body: { hours: Number(hours) } });
      toast.push({ tone: 'positive', title: 'Cool-off started' });
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Could not start cool-off', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function exclude() {
    setBusy(true);
    try {
      await api('/api/responsible/self-exclusion', { method: 'POST', body: { months: months === 'indefinite' ? null : Number(months), confirm } });
      setOpen(false);
      toast.push({ tone: 'positive', title: 'Self-exclusion active' });
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Could not self-exclude', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader title="Take a break" subtitle="Pause all wagering. A break cannot be shortened once started." />
        <CardBody className="space-y-4">
          {data.coolOffUntil ? (
            <Callout tone="warning" title="Cool-off active">Wagering is paused until {new Date(data.coolOffUntil).toLocaleString()}.</Callout>
          ) : (
            <>
              <Select value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Break length">
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
                <option value="168">7 days</option>
                <option value="720">30 days</option>
              </Select>
              <Button onClick={coolOff} loading={busy}>
                Start break
              </Button>
            </>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Self-exclusion" subtitle="Block all wagering for a long period. It cannot be reversed early." />
        <CardBody className="space-y-4">
          {data.selfExcludedUntil ? (
            <Callout tone="warning" title="Self-excluded">
              Wagering is blocked until {new Date(data.selfExcludedUntil).getUTCFullYear() >= 9999 ? 'further notice (indefinite)' : new Date(data.selfExcludedUntil).toLocaleDateString()}.
            </Callout>
          ) : (
            <>
              <Select value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Exclusion length">
                <option value="6">6 months</option>
                <option value="12">1 year</option>
                <option value="60">5 years</option>
                <option value="indefinite">Indefinitely</option>
              </Select>
              <Button variant="danger" onClick={() => setOpen(true)}>
                Self-exclude
              </Button>
            </>
          )}
        </CardBody>
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Confirm self-exclusion"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={exclude} loading={busy} disabled={confirm !== 'EXCLUDE'}>
              Confirm
            </Button>
          </>
        }
      >
        <p>You will not be able to place any wagers for the selected period, and it cannot be shortened. You can still sign in to view your history and export your data.</p>
        <div className="mt-4">
          <Field label='Type "EXCLUDE" to confirm'>{(p) => <Input {...p} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
        </div>
      </Modal>
    </div>
  );
}

export function UsageSummary({ data }: { data: ResponsibleData }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="surface-raised px-4 py-3.5">
        <div className="text-[11px] uppercase tracking-[0.1em] text-ink-400">Wagered, last 24 h</div>
        <div className="mt-1.5 text-xl font-semibold">
          <Chips amount={data.usage.wagered24h} />
        </div>
      </div>
      <div className="surface-raised px-4 py-3.5">
        <div className="text-[11px] uppercase tracking-[0.1em] text-ink-400">Net result, last 24 h</div>
        <div className="mt-1.5 text-xl font-semibold">
          <Chips amount={-data.usage.netLoss24h} sign colored />
        </div>
      </div>
      <div className="surface-raised px-4 py-3.5">
        <div className="text-[11px] uppercase tracking-[0.1em] text-ink-400">Net result, last 7 days</div>
        <div className="mt-1.5 text-xl font-semibold">
          <Chips amount={-data.usage.netLoss7d} sign colored />
        </div>
      </div>
    </div>
  );
}
