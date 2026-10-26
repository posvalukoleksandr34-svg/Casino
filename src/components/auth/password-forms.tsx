'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>('/api/auth/password/forgot', { method: 'POST', body: { email } });
      setDone(res.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (done) return <Callout tone="positive" title="Check your inbox">{done}</Callout>;
  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <Callout tone="negative">{error}</Callout>}
      <Field label="E-mail">{(p) => <Input {...p} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (!token) return <Callout tone="negative">This reset link is incomplete.</Callout>;
  if (done)
    return (
      <Callout tone="positive" title="Password updated">
        All other sessions were signed out. <Link href="/login" className="text-gold-400">Sign in</Link> with your new password.
      </Callout>
    );
  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <Callout tone="negative">{error}</Callout>}
      <Field label="New password" hint="At least 10 characters.">
        {(p) => <Input {...p} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        Set new password
      </Button>
    </form>
  );
}
