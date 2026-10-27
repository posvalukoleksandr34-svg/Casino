'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isPossiblePhoneNumber, parsePhoneNumberWithError, type CountryCode } from 'libphonenumber-js/min';
import { useId, useRef, useState, type FormEvent } from 'react';
import { dateOfBirthProblem, MINIMUM_AGE, nameProblem, utcToday } from '@/lib/account-policy';
import { api, ApiError } from '@/lib/api';
import { AvatarPicker } from '../account/avatar-picker';
import { Button } from '../ui/button';
import { CountryCombobox, type CountryChoice } from '../ui/country-combobox';
import { Field, Input, Select } from '../ui/form';
import { Callout } from '../ui/misc';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Key = 'firstName' | 'lastName' | 'dateOfBirth' | 'countryCode' | 'phoneRegion' | 'phoneNumber' | 'displayName';

function isoDate(day: string, month: string, year: string): string {
  if (!day || !month || !/^\d{4}$/.test(year)) return '';
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function phonePreview(region: string, number: string): string | null {
  try {
    if (!region || !number.trim() || !isPossiblePhoneNumber(number, region as CountryCode)) return null;
    return parsePhoneNumberWithError(number, region as CountryCode).formatInternational();
  } catch {
    return null;
  }
}

/**
 * Step 3: legal name, date of birth, country of residence and phone number
 * (plus the optional display name and avatar from the profile). Validation
 * here is a convenience; the server validates every field again and decides.
 */
export function OnboardingForm({
  countries,
  phoneRegions,
  username,
  initialDisplayName,
  initialAvatar,
}: {
  countries: CountryChoice[];
  phoneRegions: CountryChoice[];
  username: string;
  initialDisplayName: string | null;
  initialAvatar: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const countryId = useId();
  const regionId = useId();
  const [names, setNames] = useState({ firstName: '', lastName: '' });
  const [dob, setDob] = useState({ day: '', month: '', year: '' });
  const [countryCode, setCountry] = useState('');
  const [phoneRegion, setPhoneRegion] = useState('');
  const [regionTouched, setRegionTouched] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '');
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<Key, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dateOfBirth = isoDate(dob.day, dob.month, dob.year);
  const preview = phonePreview(phoneRegion, phoneNumber);
  const clientErrors: Partial<Record<Key, string>> = {
    firstName: nameProblem(names.firstName, 'first name') ?? undefined,
    lastName: nameProblem(names.lastName, 'last name') ?? undefined,
    dateOfBirth: !dob.day || !dob.month || !dob.year ? 'Enter your full date of birth' : (dateOfBirthProblem(dateOfBirth, utcToday()) ?? undefined),
    countryCode: countryCode ? undefined : 'Choose your country of residence',
    phoneRegion: phoneRegion ? undefined : 'Choose the country of your phone number',
    phoneNumber: !phoneNumber.trim() ? 'Enter your phone number' : preview ? undefined : 'Enter a valid phone number for the selected country',
  };
  const shown = (k: Key) => serverErrors[k] ?? (touched[k] ? clientErrors[k] : undefined);
  const touch = (k: Key) => () => setTouched((t) => ({ ...t, [k]: true }));
  const clear = (k: Key) => setServerErrors((s) => ({ ...s, [k]: undefined }));

  const chooseCountry = (code: string) => {
    setCountry(code);
    clear('countryCode');
    // Suggest the matching calling code until the player picks one themselves.
    if (!regionTouched && phoneRegions.some((r) => r.code === code)) setPhoneRegion(code);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const invalid = (Object.keys(clientErrors) as Key[]).filter((k) => clientErrors[k]);
    if (invalid.length) {
      setTouched(Object.fromEntries(invalid.map((k) => [k, true])));
      formRef.current?.querySelector<HTMLElement>(`[name="${invalid[0]}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await api('/api/onboarding', {
        method: 'POST',
        body: { ...names, dateOfBirth, countryCode, phoneRegion, phoneNumber, displayName: displayName.trim() || null, avatar },
      });
      router.push('/lobby?welcome=1');
      router.refresh();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        if (err.code === 'CONFLICT' && err.details?.reason === 'already_complete') {
          router.push('/lobby');
          router.refresh();
          return;
        }
        const fe: Partial<Record<Key, string>> = {};
        for (const i of (err.details?.issues as { path: string; message: string }[] | undefined) ?? []) fe[i.path as Key] ??= i.message;
        setServerErrors(fe);
        setError(err.message);
        const first = (Object.keys(fe) as Key[])[0];
        if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      } else setError('We could not reach Aurovane. Check your connection and submit again — nothing was lost.');
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-8" noValidate>
      {error && (
        <Callout tone="negative" role="alert">
          {error}
        </Callout>
      )}

      <section aria-labelledby="ob-name" className="space-y-4">
        <div>
          <h2 id="ob-name" className="text-sm font-semibold text-ink-100">
            Your name
          </h2>
          <p className="text-xs text-ink-400">Your legal name, as on official documents. It is never shown to other players; your username stays your public name.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={shown('firstName')}>
            {(p) => (
              <Input {...p} name="firstName" autoComplete="given-name" maxLength={80} value={names.firstName} onBlur={touch('firstName')} onChange={(e) => (setNames((n) => ({ ...n, firstName: e.target.value })), clear('firstName'))} />
            )}
          </Field>
          <Field label="Last name" error={shown('lastName')}>
            {(p) => (
              <Input {...p} name="lastName" autoComplete="family-name" maxLength={80} value={names.lastName} onBlur={touch('lastName')} onChange={(e) => (setNames((n) => ({ ...n, lastName: e.target.value })), clear('lastName'))} />
            )}
          </Field>
        </div>
      </section>

      <section aria-labelledby="ob-dob" className="space-y-3">
        <fieldset aria-describedby="ob-dob-hint" aria-invalid={shown('dateOfBirth') ? true : undefined}>
          <legend id="ob-dob" className="text-sm font-semibold text-ink-100">
            Date of birth
          </legend>
          <p id="ob-dob-hint" className="mb-3 text-xs text-ink-400">
            Aurovane is for adults: you must be at least {MINIMUM_AGE}. We check this on our server.
          </p>
          <div className="grid grid-cols-[5rem_1fr_6rem] gap-3">
            <Field label="Day">
              {(p) => (
                <Input
                  {...p}
                  name="dateOfBirth"
                  inputMode="numeric"
                  autoComplete="bday-day"
                  placeholder="DD"
                  maxLength={2}
                  value={dob.day}
                  onBlur={touch('dateOfBirth')}
                  onChange={(e) => (setDob((d) => ({ ...d, day: e.target.value.replace(/\D/g, '') })), clear('dateOfBirth'))}
                />
              )}
            </Field>
            <Field label="Month">
              {(p) => (
                <Select {...p} autoComplete="bday-month" value={dob.month} onBlur={touch('dateOfBirth')} onChange={(e) => (setDob((d) => ({ ...d, month: e.target.value })), clear('dateOfBirth'))}>
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={String(i + 1)}>
                      {m}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Year">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="bday-year"
                  placeholder="YYYY"
                  maxLength={4}
                  value={dob.year}
                  onBlur={touch('dateOfBirth')}
                  onChange={(e) => (setDob((d) => ({ ...d, year: e.target.value.replace(/\D/g, '') })), clear('dateOfBirth'))}
                />
              )}
            </Field>
          </div>
          {shown('dateOfBirth') && (
            <p role="alert" className="mt-2 text-xs text-negative">
              {shown('dateOfBirth')}
            </p>
          )}
        </fieldset>
      </section>

      <section aria-labelledby="ob-country" className="space-y-4">
        <div>
          <h2 id="ob-country" className="text-sm font-semibold text-ink-100">
            Where you live
          </h2>
          <p className="text-xs text-ink-400">Your country of residence. Type to search; we never guess it from your connection.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={countryId} className="block text-xs font-medium uppercase tracking-[0.08em] text-ink-300">
            Country of residence
          </label>
          <CountryCombobox id={countryId} name="countryCode" options={countries} value={countryCode} onChange={chooseCountry} invalid={Boolean(shown('countryCode'))} describedBy={shown('countryCode') ? `${countryId}-error` : undefined} />
          {shown('countryCode') && (
            <p id={`${countryId}-error`} role="alert" className="text-xs text-negative">
              {shown('countryCode')}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="ob-phone" className="space-y-4">
        <div>
          <h2 id="ob-phone" className="text-sm font-semibold text-ink-100">
            How to reach you
          </h2>
          <p className="text-xs text-ink-400">
            Support may use it to help confirm that an account is yours. We do not send text messages or marketing, and the number is stored as unverified.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,15rem)_1fr]">
          <div className="space-y-1.5">
            <label htmlFor={regionId} className="block text-xs font-medium uppercase tracking-[0.08em] text-ink-300">
              Country code
            </label>
            <CountryCombobox
              id={regionId}
              name="phoneRegion"
              options={phoneRegions}
              value={phoneRegion}
              showCallingCode
              placeholder="Search or type +44"
              onChange={(code) => {
                setPhoneRegion(code);
                setRegionTouched(true);
                clear('phoneRegion');
              }}
              invalid={Boolean(shown('phoneRegion'))}
              describedBy={shown('phoneRegion') ? `${regionId}-error` : undefined}
            />
            {shown('phoneRegion') && (
              <p id={`${regionId}-error`} role="alert" className="text-xs text-negative">
                {shown('phoneRegion')}
              </p>
            )}
          </div>
          <Field label="Phone number" error={shown('phoneNumber')} hint={preview ? `Saved as ${preview}` : 'Your national number, e.g. 020 7946 0018'}>
            {(p) => (
              <div className="flex">
                <span className="inline-flex h-11 items-center rounded-l-xl border border-r-0 border-ink-600 bg-ink-850 px-3 text-sm text-ink-300" aria-hidden="true">
                  {phoneRegions.find((r) => r.code === phoneRegion)?.callingCode ? `+${phoneRegions.find((r) => r.code === phoneRegion)!.callingCode}` : '+'}
                </span>
                <Input {...p} name="phoneNumber" type="tel" inputMode="tel" autoComplete="tel-national" maxLength={40} className="rounded-l-none" value={phoneNumber} onBlur={touch('phoneNumber')} onChange={(e) => (setPhoneNumber(e.target.value), clear('phoneNumber'))} />
              </div>
            )}
          </Field>
        </div>
      </section>

      <details className="rounded-xl border border-ink-700 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink-100">How you appear (optional)</summary>
        <div className="mt-4 space-y-5">
          <Field label="Display name" hint="2–32 characters. Leave empty to use your username." error={shown('displayName')}>
            {(p) => <Input {...p} name="displayName" maxLength={32} placeholder={username} value={displayName} onChange={(e) => (setDisplayName(e.target.value), clear('displayName'))} />}
          </Field>
          <AvatarPicker value={avatar} onChange={setAvatar} name={displayName.trim() || username} />
        </div>
      </details>

      <div className="space-y-3">
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Save and enter the lobby
        </Button>
        <p className="text-center text-xs text-ink-400">
          We use these details as described in the{' '}
          <Link href="/privacy" target="_blank" className="text-gold-400">
            Privacy Notice
          </Link>
          . You can review or change them later in Settings, and export or delete your data at any time.
        </p>
      </div>
    </form>
  );
}
