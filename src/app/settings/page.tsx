import Link from 'next/link';
import { parsePhoneNumberWithError } from 'libphonenumber-js/max';
import { DetailsForm, EmailSettings } from '@/components/account/account-details';
import { DataControls, PasswordForm, PreferencesForm } from '@/components/account/settings-forms';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { phoneRegionOptions, residenceCountries } from '@/server/users/countries';
import { accountDetails } from '@/server/users/onboarding';
import { emailChangeStatus } from '@/server/users/verification';

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
  const [details, pending] = await Promise.all([accountDetails(session.userId), emailChangeStatus(session.userId)]);
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Account settings"
        subtitle="Your e-mail, personal details, security, display preferences and privacy controls."
        actions={<Link href="/responsible-play" className="text-sm text-gold-400 hover:text-gold-300">Play limits →</Link>}
      />
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
        <PasswordForm />
        <PreferencesForm />
        <DataControls />
      </div>
    </>
  );
}
