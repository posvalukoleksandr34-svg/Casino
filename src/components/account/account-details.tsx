'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { normaliseCode, VERIFICATION_CODE_LENGTH } from '@/lib/account-policy';
import { api, ApiError, errorMessage } from '@/lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { CountryCombobox, type CountryChoice } from '../ui/country-combobox';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';
import { PasswordInput } from '../ui/password-input';
import { useToast } from '../ui/toast';

export interface PendingEmailChange {
  email: string;
  sent: boolean | null;
  expiresAt: string;
  attemptsLeft: number;
  resendAvailableAt: string;
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000)) : 0;
}

/**
 * E-mail address and its verification status. A change is confirmed with a
 * code sent to the new address; until then the current address stays in use.
 */
export function EmailSettings({ email, verification, initialPending }: { email: string; verification: string | null; initialPending: PendingEmailChange | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(initialPending);
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCountdown(pending?.resendAvailableAt ?? null);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy('start');
    setError(null);
    try {
      const res = await api<{ sent: boolean; pending: PendingEmailChange }>('/api/account/email', { method: 'POST', body: { email: newEmail.trim(), password } });
      setPending(res.pending);
      setEditing(false);
      setPassword('');
      if (!res.sent) setError('We could not send the e-mail just now. Use "Send a new code" in a moment.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm(value: string) {
    if (value.length !== VERIFICATION_CODE_LENGTH) return;
    setBusy('confirm');
    setError(null);
    try {
      const res = await api<{ email: string }>('/api/account/email/confirm', { method: 'POST', body: { code: value } });
      setPending(null);
      setCode('');
      toast.push({ tone: 'positive', title: 'E-mail address changed', body: `You now sign in with ${res.email}. Other sessions were signed out.` });
      router.refresh();
    } catch (err) {
      setCode('');
      if (err instanceof ApiError && typeof err.details?.attemptsLeft === 'number') setPending((p) => (p ? { ...p, attemptsLeft: err.details!.attemptsLeft as number } : p));
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    setBusy('resend');
    setError(null);
    try {
      const res = await api<{ sent: boolean; pending: PendingEmailChange }>('/api/account/email', { method: 'POST', body: {} });
      setPending(res.pending);
      if (!res.sent) setError('We could not send the e-mail just now. Try again in a moment.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy('cancel');
    try {
      await api('/api/account/email', { method: 'DELETE' });
      setPending(null);
      setCode('');
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title="E-mail address" subtitle="Used to sign in and for security messages. A new address must be confirmed before it replaces this one." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="break-all text-sm text-ink-100" data-testid="settings-email">
            {email}
          </span>
          {verification === 'CODE' || verification === 'OPERATOR' ? (
            <Badge tone="positive">Verified</Badge>
          ) : verification === 'LEGACY_MIGRATION' ? (
            <Badge tone="warning">Not re-verified (account predates verification)</Badge>
          ) : (
            <Badge tone="warning">Not verified</Badge>
          )}
        </div>
        {verification === 'LEGACY_MIGRATION' && !pending && (
          <p className="text-xs text-ink-400">Your account was created before e-mail verification existed. Changing your address below confirms the new one with a code.</p>
        )}
        {error && (
          <Callout tone="negative" role="alert">
            {error}
          </Callout>
        )}
        {pending ? (
          <div className="space-y-3 rounded-xl border border-gold-700/50 bg-ink-900/60 p-4" aria-live="polite">
            <p className="text-sm text-ink-200">
              Enter the code we sent to <strong className="break-all text-ink-100">{pending.email}</strong>.{' '}
              <span className="text-ink-400">{pending.attemptsLeft} attempt{pending.attemptsLeft === 1 ? '' : 's'} left; the code expires {new Date(pending.expiresAt).toLocaleTimeString()}.</span>
            </p>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                void confirm(code);
              }}
            >
              <Field label="Code from the e-mail" className="sm:w-56">
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="text-center font-mono tracking-[0.35em]"
                    value={code}
                    onChange={(e) => {
                      const next = normaliseCode(e.target.value);
                      setCode(next);
                      if (next.length === VERIFICATION_CODE_LENGTH) void confirm(next);
                    }}
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" loading={busy === 'confirm'} disabled={code.length !== VERIFICATION_CODE_LENGTH}>
                Confirm new address
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="subtle" onClick={resend} loading={busy === 'resend'} disabled={cooldown > 0}>
                {cooldown > 0 ? `New code in ${cooldown}s` : 'Send a new code'}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel} loading={busy === 'cancel'}>
                Keep my current address
              </Button>
            </div>
          </div>
        ) : editing ? (
          <form onSubmit={start} className="grid gap-4 sm:grid-cols-2">
            <Field label="New e-mail address">{(p) => <Input {...p} type="email" inputMode="email" autoComplete="email" required maxLength={254} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />}</Field>
            <Field label="Current password">{(p) => <PasswordInput {...p} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant="primary" loading={busy === 'start'} disabled={!newEmail.includes('@') || !password}>
                Send confirmation code
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="subtle" onClick={() => setEditing(true)}>
            Change e-mail address
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

export interface DetailsView {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  countryCode: string | null;
  phoneE164: string | null;
  phoneDisplay: string | null;
  phoneVerified: boolean;
  phoneRegion: string | null;
}

/** Legal name, date of birth (set once), country and phone number. */
export function DetailsForm({ initial, countries, phoneRegions, required }: { initial: DetailsView; countries: CountryChoice[]; phoneRegions: CountryChoice[]; required: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const countryId = useId();
  const regionId = useId();
  const [form, setForm] = useState({
    firstName: initial.firstName ?? '',
    lastName: initial.lastName ?? '',
    dateOfBirth: initial.dateOfBirth ?? '',
    countryCode: initial.countryCode ?? '',
    phoneRegion: initial.phoneRegion ?? initial.countryCode ?? '',
    phoneNumber: initial.phoneDisplay ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const body: Record<string, string> = {};
    if (form.firstName.trim() !== (initial.firstName ?? '')) body.firstName = form.firstName;
    if (form.lastName.trim() !== (initial.lastName ?? '')) body.lastName = form.lastName;
    if (!initial.dateOfBirth && form.dateOfBirth) body.dateOfBirth = form.dateOfBirth;
    if (form.countryCode && form.countryCode !== initial.countryCode) body.countryCode = form.countryCode;
    if (form.phoneNumber.trim() && (form.phoneNumber.trim() !== (initial.phoneDisplay ?? '') || form.phoneRegion !== (initial.phoneRegion ?? ''))) {
      body.phoneRegion = form.phoneRegion;
      body.phoneNumber = form.phoneNumber;
    }
    try {
      await api('/api/account/details', { method: 'PATCH', body });
      toast.push({ tone: 'positive', title: 'Details saved' });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const fe: Record<string, string> = {};
        for (const i of (err.details?.issues as { path: string; message: string }[] | undefined) ?? []) fe[i.path] ??= i.message;
        setErrors(fe);
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Personal details"
        subtitle={required ? 'Given when you completed your profile. Only you and authorised staff can see them.' : 'Optional for your account (it predates the profile step). Only you and authorised staff can see them.'}
      />
      <CardBody>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="First name" error={errors.firstName}>
            {(p) => <Input {...p} autoComplete="given-name" maxLength={80} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />}
          </Field>
          <Field label="Last name" error={errors.lastName}>
            {(p) => <Input {...p} autoComplete="family-name" maxLength={80} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />}
          </Field>
          <Field label="Date of birth" hint={initial.dateOfBirth ? 'On record. Contact support if it is wrong.' : 'Can be set once.'} error={errors.dateOfBirth}>
            {(p) => <Input {...p} type="date" autoComplete="bday" value={form.dateOfBirth} disabled={Boolean(initial.dateOfBirth)} onChange={(e) => set('dateOfBirth', e.target.value)} />}
          </Field>
          <div className="space-y-1.5">
            <label htmlFor={countryId} className="block text-xs font-medium uppercase tracking-[0.08em] text-ink-300">
              Country of residence
            </label>
            <CountryCombobox id={countryId} options={countries} value={form.countryCode} onChange={(c) => set('countryCode', c)} invalid={Boolean(errors.countryCode)} />
            {errors.countryCode && <p className="text-xs text-negative">{errors.countryCode}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={regionId} className="block text-xs font-medium uppercase tracking-[0.08em] text-ink-300">
              Phone country code
            </label>
            <CountryCombobox id={regionId} options={phoneRegions} value={form.phoneRegion} showCallingCode onChange={(c) => set('phoneRegion', c)} />
          </div>
          <Field
            label="Phone number"
            error={errors.phoneNumber}
            hint={
              <>
                {initial.phoneVerified ? 'Verified.' : 'Not verified — we do not send text messages.'} Changing it keeps it unverified.
              </>
            }
          >
            {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)} />}
          </Field>
          {error && (
            <Callout tone="negative" role="alert" className="sm:col-span-2">
              {error}
            </Callout>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" loading={busy}>
              Save details
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
