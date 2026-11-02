import Link from 'next/link';
import { parsePhoneNumberWithError } from 'libphonenumber-js/max';
import { DetailsForm, EmailSettings } from '@/components/account/account-details';
import { DataControls, PreferencesForm } from '@/components/account/settings-forms';
import { AccountTabs } from '@/components/account/account-tabs';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { phoneRegionOptions, residenceCountries } from '@/server/users/countries';
import { accountDetails } from '@/server/users/onboarding';
import { emailChangeStatus } from '@/server/users/verification';
import { phoneVerificationStatus } from '@/server/users/phone-verification';
import { PhoneVerify } from '@/components/account/phone-verify';

export const metadata = { title: 'Account settings' };

function phoneRegionOf(e164: string | null): string | null {
  if (!e164) return null;
  try {
    return parsePhoneNumberWithError(e164).country ?? null;
  } catch {
    return null;
  }
}

export default async function SettingsPage() {
  const session = await requireUser('/settings');
  const [details, pending, phone] = await Promise.all([accountDetails(session.userId), emailChangeStatus(session.userId), phoneVerificationStatus(session.userId)]);
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Account settings"
        subtitle="Your e-mail, personal details, display preferences and privacy controls."
        actions={<Link href="/responsible-play" className="text-sm text-gold-400 hover:text-gold-300">Play limits →</Link>}
      />
      <AccountTabs />
      <div className="grid gap-6">
        <EmailSettings email={session.email} verification={details.emailVerificationMethod} initialPending={pending} />
        <DetailsForm
          required={details.onboardingRequired}
          countries={residenceCountries()}
          phoneRegions={phoneRegionOptions()}
          initial={{
            firstName: details.firstName,
            lastName: details.lastName,
            dateOfBirth: details.dateOfBirth,
            countryCode: details.countryCode,
            phoneE164: details.phoneE164,
            phoneDisplay: details.phoneDisplay,
            phoneVerified: details.phoneVerified,
            phoneRegion: phoneRegionOf(details.phoneE164),
          }}
        />
        <PhoneVerify initial={phone} display={details.phoneDisplay} />
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-300">Password, two-factor authentication, devices and sign-in history are on the Security page.</span>
            <Link href="/settings/security" className="text-sm font-medium text-gold-400 hover:text-gold-300">
              Security →
            </Link>
          </CardBody>
        </Card>
        <PreferencesForm />
        <DataControls />
      </div>
    </>
  );
}
