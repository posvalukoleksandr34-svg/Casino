'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/safe-next';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';

/**
 * Password sign-in. Accounts with two-factor authentication get a second
 * step: the server answers MFA_REQUIRED with a short-lived challenge, which is
 * exchanged together with an authenticator (or recovery) code for a session.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = () => {
    router.push(safeNextPath(params.get('next'), window.location.origin));
    router.refresh();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) await api('/api/auth/login/mfa', { method: 'POST', body: { challenge, code } });
      else await api('/api/auth/login', { method: 'POST', body: { email, password } });
      done();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED' && typeof err.details?.challenge === 'string') {
        setChallenge(err.details.challenge);
        setPassword('');
      } else if (challenge && err instanceof ApiError && err.message.includes('expired')) {
        setChallenge(null);
        setCode('');
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && (
        <Callout tone="negative" role="alert">
          {error}
        </Callout>
      )}
      {challenge ? (
        <>
          <Callout tone="info" role="status">
            Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app, or one of your recovery codes.
          </Callout>
          <Field label="Authentication code">
            {(p) => (
              <Input
                {...p}
                autoComplete="one-time-code"
                inputMode="text"
                autoFocus
                required
                maxLength={20}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={code.trim().length < 6}>
            Verify and sign in
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-ink-400 hover:text-ink-200"
            onClick={() => {
              setChallenge(null);
              setCode('');
              setError(null);
            }}
          >
            Use a different account
          </button>
        </>
      ) : (
        <>
          <Field label="E-mail">
            {(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Password">
            {(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Sign in
          </Button>
        </>
      )}
    </form>
  );
}
