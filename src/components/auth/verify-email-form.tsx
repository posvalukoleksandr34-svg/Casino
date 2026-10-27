'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { normaliseCode, VERIFICATION_CODE_LENGTH } from '@/lib/account-policy';
import { api, ApiError } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';

export interface VerificationView {
  email: string;
  delivery: 'email' | 'console' | 'unavailable';
  sent: boolean | null;
  expiresAt: string | null;
  attemptsLeft: number | null;
  resendAvailableAt: string;
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function seconds(ms: number) {
  return Math.max(0, Math.ceil(ms / 1000));
}

function mmss(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Step 2: six-digit code entry (paste-friendly, numeric keypad on phones),
 * resend with a visible cooldown, address correction, and clear handling of
 * wrong, expired and exhausted codes. The code is never echoed back.
 */
export function VerifyEmailForm({ initial }: { initial: VerificationView }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'verify' | 'resend' | 'change' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const now = useNow();
  const cooldown = seconds(new Date(status.resendAvailableAt).getTime() - now);
  const expiresIn = status.expiresAt ? seconds(new Date(status.expiresAt).getTime() - now) : 0;
  const expired = Boolean(status.expiresAt) && expiresIn === 0;
  const deliveryFailed = status.sent === false;

  const apply = (v: VerificationView | null | undefined) => {
    if (v) setStatus(v);
  };

  async function verify(value: string) {
    if (value.length !== VERIFICATION_CODE_LENGTH || busy) return;
    setBusy('verify');
    setError(null);
    setNotice(null);
    try {
      await api('/api/auth/verify-email', { method: 'POST', body: { code: value } });
      setNotice('E-mail confirmed. Taking you to the next step…');
      router.push('/onboarding');
      router.refresh();
    } catch (err) {
      setBusy(null);
      setCode('');
      if (err instanceof ApiError) {
        const reason = err.details?.reason;
        if (reason === 'too_many_attempts' || reason === 'expired' || reason === 'no_code') setNeedsNewCode(true);
        if (typeof err.details?.attemptsLeft === 'number') setStatus((s) => ({ ...s, attemptsLeft: err.details!.attemptsLeft as number }));
        if (reason === 'already_verified' || err.code === 'UNAUTHENTICATED') {
          setError(`${err.message}`);
          return;
        }
        setError(err.message);
      } else setError('We could not reach Aurovane. Check your connection and enter the code again.');
      codeRef.current?.focus();
    }
  }

  async function resend() {
    setBusy('resend');
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ sent: boolean; verification: VerificationView }>('/api/auth/verify-email/resend', { method: 'POST', body: {} });
      apply(res.verification);
      setNeedsNewCode(!res.sent);
      setCode('');
      if (res.sent) setNotice(status.delivery === 'console' ? 'A new code was written to the development server console. Earlier codes no longer work.' : `A new code is on its way to ${res.verification.email}. Earlier codes no longer work.`);
      else setError('We could not send the e-mail just now. Please try again in a moment.');
      codeRef.current?.focus();
    } catch (err) {
      if (err instanceof ApiError && typeof err.details?.retryAfterSeconds === 'number') {
        setStatus((s) => ({ ...s, resendAvailableAt: new Date(Date.now() + (err.details!.retryAfterSeconds as number) * 1000).toISOString() }));
      }
      setError(err instanceof ApiError ? err.message : 'We could not reach Aurovane. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  }

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    setBusy('change');
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ sent: boolean; verification: VerificationView }>('/api/auth/verify-email/change-email', { method: 'POST', body: { email: newEmail.trim() } });
      apply(res.verification);
      setChanging(false);
      setNewEmail('');
      setCode('');
      setNeedsNewCode(!res.sent);
      if (res.sent) setNotice(`We sent a new code to ${res.verification.email}.`);
      else setError('Your address was updated, but we could not send the e-mail just now. Use "Send a new code" in a moment.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not reach Aurovane. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  }

  async function startOver() {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    router.push('/register');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4 text-sm">
        <p className="text-ink-300">We are verifying</p>
        <p className="mt-0.5 break-all font-medium text-ink-100" data-testid="verify-email-address">
          {status.email}
        </p>
        <p className="mt-2 text-xs text-ink-400">
          {status.delivery === 'console'
            ? 'Development server: no e-mail is sent; the code is printed in the server console.'
            : deliveryFailed
              ? 'The last e-mail could not be sent. Request a new code below.'
              : 'It can take a minute to arrive. Check your spam or promotions folder too.'}
        </p>
      </div>

      <div aria-live="polite" className="space-y-3">
        {notice && (
          <Callout tone="positive" role="status">
            {notice}
          </Callout>
        )}
        {error && (
          <Callout tone="negative" role="alert">
            {error}
          </Callout>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
        className="space-y-4"
        noValidate
      >
        <Field
          label="Verification code"
          hint={
            status.expiresAt && !needsNewCode
              ? expired
                ? 'This code has expired. Request a new one.'
                : `${VERIFICATION_CODE_LENGTH} digits · expires in ${mmss(expiresIn)}${status.attemptsLeft !== null && status.attemptsLeft < 5 ? ` · ${status.attemptsLeft} attempt${status.attemptsLeft === 1 ? '' : 's'} left` : ''}`
              : 'Request a new code to continue.'
          }
        >
          {(p) => (
            <Input
              {...p}
              ref={codeRef}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              pattern="[0-9]*"
              maxLength={VERIFICATION_CODE_LENGTH + 6}
              placeholder="••••••"
              className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
              value={code}
              disabled={busy === 'verify'}
              onChange={(e) => {
                const next = normaliseCode(e.target.value);
                setCode(next);
                if (next.length === VERIFICATION_CODE_LENGTH) void verify(next);
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy === 'verify'} disabled={code.length !== VERIFICATION_CODE_LENGTH}>
          Verify e-mail
        </Button>
      </form>

      <div className="flex flex-col gap-3 border-t border-ink-800 pt-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <Button variant="subtle" onClick={resend} loading={busy === 'resend'} disabled={cooldown > 0 || busy !== null}>
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        </Button>
        <button type="button" className="text-left text-gold-400 hover:text-gold-300 sm:text-right" onClick={() => setChanging((v) => !v)} aria-expanded={changing}>
          Wrong address? Change it
        </button>
      </div>

      {changing && (
        <form onSubmit={changeEmail} className="space-y-3 rounded-xl border border-ink-700 p-4" noValidate>
          <Field label="New e-mail address" hint="We send a new code there; the old code stops working.">
            {(p) => <Input {...p} type="email" inputMode="email" autoComplete="email" autoFocus required maxLength={254} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={busy === 'change'} disabled={!newEmail.includes('@') || cooldown > 0}>
              {cooldown > 0 ? `Available in ${cooldown}s` : 'Use this address'}
            </Button>
            <Button variant="ghost" onClick={() => setChanging(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <p className="text-center text-xs text-ink-400">
        Registered by mistake?{' '}
        <button type="button" onClick={startOver} className="text-gold-400 hover:text-gold-300">
          Start over
        </button>{' '}
        or{' '}
        <Link href="/login" className="text-gold-400 hover:text-gold-300">
          sign in
        </Link>
        .
      </p>
    </div>
  );
}
