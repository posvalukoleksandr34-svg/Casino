import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import { requireUser } from '@/server/auth/current';
import { phoneRegionOptions, residenceCountries } from '@/server/users/countries';

export const metadata = { title: 'Your details' };

/** Step 3, mandatory for new accounts before anything else on the site (enforced on the server). */
export default async function OnboardingPage() {
  const session = await requireUser('/onboarding', { allowOnboarding: true });
  if (!session.onboardingPending) redirect('/lobby');
  return (
    <AuthShell step={3} wide title="A few details about you" subtitle="Your e-mail is confirmed. Complete your profile to enter the lobby — this takes a minute and is asked only once.">
      <OnboardingForm countries={residenceCountries()} phoneRegions={phoneRegionOptions()} username={session.username} initialDisplayName={session.displayName} initialAvatar={session.avatar} />
    </AuthShell>
  );
}
