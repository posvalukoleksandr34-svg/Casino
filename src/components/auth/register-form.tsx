'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { MINIMUM_AGE, PASSWORD_MIN_LENGTH, passwordProblems } from '@/lib/account-policy';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';
import { PasswordInput } from '../ui/password-input';

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldName = 'username' | 'email' | 'password' | 'confirmPassword' | 'ageConfirmed' | 'chipsAcknowledged' | 'termsAccepted';

/**
 * Step 1: username, e-mail, password (twice) and the three required
 * confirmations. Checks run in the browser for quick feedback and again on
 * the server, which decides. Success leads to the e-mail verification step;
 * no session exists yet.
 */
export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [checks, setChecks] = useState({ ageConfirmed: false, chipsAcknowledged: false, termsAccepted: false });
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const policy = passwordProblems(form.password, { email: form.email.trim(), username: form.username.trim() });
  const clientErrors: Partial<Record<FieldName, string>> = {
    username: !form.username.trim() ? 'Choose a username' : !USERNAME.test(form.username.trim()) ? 'Use 3–32 letters, digits, "_", "." or "-"' : undefined,
    email: !form.email.trim() ? 'Enter your e-mail address' : !EMAIL.test(form.email.trim()) ? 'Enter a valid e-mail address' : undefined,
    password: !form.password ? 'Choose a password' : policy[0],
    confirmPassword: !form.confirmPassword ? 'Repeat your password' : form.confirmPassword !== form.password ? 'The passwords do not match' : undefined,
    ageConfirmed: checks.ageConfirmed ? undefined : `Confirm that you are at least ${MINIMUM_AGE}`,
    chipsAcknowledged: checks.chipsAcknowledged ? undefined : 'Acknowledge that chips are virtual',
    termsAccepted: checks.termsAccepted ? undefined : 'Accept the terms to continue',
  };
  const shown = (k: FieldName) => serverErrors[k] ?? (touched[k] ? clientErrors[k] : undefined);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setServerErrors((s) => ({ ...s, [k]: undefined }));
  };
  const blur = (k: FieldName) => () => setTouched((t) => ({ ...t, [k]: true }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const invalid = (Object.keys(clientErrors) as FieldName[]).filter((k) => clientErrors[k]);
    if (invalid.length) {
      setTouched(Object.fromEntries(invalid.map((k) => [k, true])));
      formRef.current?.querySelector<HTMLElement>(`[name="${invalid[0]}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/register', { method: 'POST', body: { ...form, username: form.username.trim(), email: form.email.trim(), ...checks } });
      router.push('/verify-email');
      router.refresh();
    } catch (err) {
      setBusy(false);
      if (!(err instanceof ApiError)) {
        setError({ text: 'We could not reach Aurovane. Check your connection and try again.', retry: true });
        return;
      }
      const fe: Partial<Record<FieldName, string>> = {};
      for (const i of (err.details?.issues as { path: string; message: string }[] | undefined) ?? []) fe[i.path as FieldName] ??= i.message;
      const pw = err.details?.password as string[] | undefined;
      if (pw?.length) fe.password = pw.join(' ');
      if (typeof err.details?.field === 'string') fe[err.details.field as FieldName] = err.message;
      setServerErrors(fe);
      const first = (Object.keys(fe) as FieldName[])[0];
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      setError({ text: err.message, retry: err.status >= 500 || err.code === 'RATE_LIMITED' });
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-5" noValidate aria-describedby="register-intro">
      <p id="register-intro" className="sr-only">
        All fields are required. After this step we e-mail you a six-digit code.
      </p>
      {error && (
        <Callout tone="negative" role="alert">
          {error.text}
          {error.retry && ' You can submit the form again.'}
        </Callout>
      )}
      <Field label="Username" hint="3–32 characters: letters, digits, _ . - — this is how you sign in and appear in the game." error={shown('username')}>
        {(p) => <Input {...p} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={32} value={form.username} onChange={set('username')} onBlur={blur('username')} />}
      </Field>
      <Field label="E-mail address" hint="We send a verification code here." error={shown('email')}>
        {(p) => <Input {...p} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={form.email} onChange={set('email')} onBlur={blur('email')} />}
      </Field>
      <Field label="Password" error={shown('password')} hint={`At least ${PASSWORD_MIN_LENGTH} characters. A passphrase of a few words works well.`}>
        {(p) => <PasswordInput {...p} name="password" autoComplete="new-password" required maxLength={200} value={form.password} onChange={set('password')} onBlur={blur('password')} />}
      </Field>
      {form.password && (
        <ul className="-mt-2 space-y-1 text-xs" aria-label="Password requirements">
          {[
            { ok: form.password.length >= PASSWORD_MIN_LENGTH, text: `At least ${PASSWORD_MIN_LENGTH} characters` },
            { ok: !policy.some((p) => p.includes('username') || p.includes('e-mail')), text: 'Does not contain your username or e-mail name' },
            { ok: !policy.some((p) => p.includes('common') || p.includes('repeating')), text: 'Not a common or repeated-character password' },
          ].map((r) => (
            <li key={r.text} className={cn('flex items-center gap-2', r.ok ? 'text-positive' : 'text-ink-400')}>
              <span aria-hidden="true">{r.ok ? '✓' : '•'}</span>
              {r.text}
              <span className="sr-only">{r.ok ? '(met)' : '(not met yet)'}</span>
            </li>
          ))}
        </ul>
      )}
      <Field label="Confirm password" error={shown('confirmPassword')}>
        {(p) => <PasswordInput {...p} name="confirmPassword" autoComplete="new-password" required maxLength={200} value={form.confirmPassword} onChange={set('confirmPassword')} onBlur={blur('confirmPassword')} />}
      </Field>

      <fieldset className="space-y-3 rounded-xl border border-ink-700 bg-ink-900/60 p-4 text-sm">
        <legend className="px-1 text-xs font-medium uppercase tracking-[0.08em] text-ink-300">Before you continue</legend>
        {(
          [
            ['ageConfirmed', <>I confirm I am at least {MINIMUM_AGE} years old.</>],
            ['chipsAcknowledged', <>I understand chips are free and virtual: they have no monetary value and cannot be bought, withdrawn or exchanged.</>],
            [
              'termsAccepted',
              <>
                I accept the{' '}
                <Link href="/terms" target="_blank" className="text-gold-400 underline-offset-2 hover:underline">
                  Terms of Service
                </Link>{' '}
                and have read the{' '}
                <Link href="/privacy" target="_blank" className="text-gold-400 underline-offset-2 hover:underline">
                  Privacy Notice
                </Link>
                .
              </>,
            ],
          ] as const
        ).map(([k, label]) => (
          <div key={k}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name={k}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-gold-500)]"
                checked={checks[k]}
                aria-invalid={shown(k) ? true : undefined}
                aria-describedby={shown(k) ? `${k}-error` : undefined}
                onChange={(e) => {
                  setChecks((c) => ({ ...c, [k]: e.target.checked }));
                  setServerErrors((s) => ({ ...s, [k]: undefined }));
                }}
              />
              <span className="text-ink-200">{label}</span>
            </label>
            {shown(k) && (
              <p id={`${k}-error`} role="alert" className="ml-7 mt-1 text-xs text-negative">
                {shown(k)}
              </p>
            )}
          </div>
        ))}
      </fieldset>
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        Create account
      </Button>
      <p className="text-center text-xs text-ink-400">
        Next, we e-mail you a code to confirm your address. Play is for entertainment only — see{' '}
        <Link href="/responsible-play" className="text-gold-400">
          responsible play
        </Link>
        .
      </p>
    </form>
  );
}
