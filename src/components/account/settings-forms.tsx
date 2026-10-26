'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '../layout/session-provider';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Field, Input, Toggle } from '../ui/form';
import { Callout } from '../ui/misc';
import { Modal } from '../ui/modal';
import { useToast } from '../ui/toast';

export function PasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/account/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      toast.push({ tone: 'positive', title: 'Password changed', body: 'Your other sessions were signed out.' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Password" subtitle="Changing your password signs out every other session." />
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password">{(p) => <Input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
          <Field label="New password" hint="At least 10 characters">
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />}
          </Field>
          {error && <Callout tone="negative" className="sm:col-span-2">{error}</Callout>}
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" loading={busy}>
              Update password
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function PreferencesForm() {
  const { user, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const prefs = (user?.preferences ?? {}) as Record<string, boolean | undefined>;
  const [busy, setBusy] = useState(false);
  async function update(key: string, value: boolean) {
    setBusy(true);
    try {
      await api('/api/account/preferences', { method: 'PATCH', body: { [key]: value } });
      await refresh();
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Could not save preference', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Display & privacy" />
      <CardBody className="space-y-5">
        <Toggle label="Reduce motion" description="Skip wheel spins and number animations; results appear immediately." checked={Boolean(prefs.reducedMotion)} onChange={(v) => update('reducedMotion', v)} disabled={busy} />
        <Toggle label="Hide balance in the header" description="Useful when sharing your screen." checked={Boolean(prefs.hideBalance)} onChange={(v) => update('hideBalance', v)} disabled={busy} />
      </CardBody>
    </Card>
  );
}

export function DataControls() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function del() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/account', { method: 'DELETE', body: { password, confirm } });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Your data" />
      <CardBody className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-lg text-ink-300">Download everything we hold about you — profile, rounds, transactions, seeds and account activity — as JSON.</p>
          <a href="/api/account/export" className="inline-flex h-10 items-center rounded-xl border border-ink-600 px-4 text-ink-200 hover:border-gold-600">
            Export my data
          </a>
        </div>
        <div className="hairline" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-lg text-ink-300">
            Delete your account. Your e-mail, username, password and preferences are erased. Game and ledger records are kept in
            pseudonymised form because financial and audit records must remain complete.
          </p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </div>
      </CardBody>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete account"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={del} loading={busy} disabled={confirm !== 'DELETE' || !password}>
              Permanently delete
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p>This cannot be undone. Any remaining virtual chips are forfeited (they have no monetary value). Open rounds must be finished first.</p>
          <Field label="Password">{(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Field label='Type "DELETE" to confirm'>{(p) => <Input {...p} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
          {error && <Callout tone="negative">{error}</Callout>}
        </div>
      </Modal>
    </Card>
  );
}
