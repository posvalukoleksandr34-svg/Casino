'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', username: '', password: '' });
  const [ageConfirmed, setAge] = useState(false);
  const [termsAccepted, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api('/api/auth/register', { method: 'POST', body: { ...form, ageConfirmed, termsAccepted } });
      router.push('/lobby?welcome=1');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const fe: Record<string, string> = {};
        const issues = (err.details?.issues as { path: string; message: string }[] | undefined) ?? [];
        for (const i of issues) fe[i.path] = i.message;
        const pw = err.details?.password as string[] | undefined;
        if (pw?.length) fe.password = pw.join(' ');
        if (typeof err.details?.field === 'string') fe[err.details.field] = err.message;
        setFieldErrors(fe);
      } else setError('Registration failed. Please try again.');
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && (
        <Callout tone="negative" role="alert">
          {error}
        </Callout>
      )}
      <Field label="E-mail" error={fieldErrors.email}>
        {(p) => <Input {...p} type="email" autoComplete="email" required value={form.email} onChange={set('email')} />}
      </Field>
      <Field label="Username" hint="3–32 characters: letters, digits, _ . -" error={fieldErrors.username}>
        {(p) => <Input {...p} autoComplete="username" required value={form.username} onChange={set('username')} />}
      </Field>
      <Field label="Password" hint="At least 10 characters. A passphrase works well." error={fieldErrors.password}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} />}
      </Field>
      <div className="space-y-3 rounded-xl border border-ink-700 bg-ink-900/60 p-4 text-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-gold-500)]" checked={ageConfirmed} onChange={(e) => setAge(e.target.checked)} />
          <span className="text-ink-200">I confirm I am at least 18 years old.</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-gold-500)]" checked={termsAccepted} onChange={(e) => setTerms(e.target.checked)} />
          <span className="text-ink-200">
            I understand chips are virtual, have no monetary value and cannot be bought, withdrawn or exchanged.
          </span>
        </label>
      </div>
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!ageConfirmed || !termsAccepted}>
        Create account
      </Button>
      <p className="text-center text-xs text-ink-500">
        You will receive 10,000 virtual welcome chips. See <Link href="/responsible-play" className="text-gold-400">responsible play</Link>.
      </p>
    </form>
  );
}
