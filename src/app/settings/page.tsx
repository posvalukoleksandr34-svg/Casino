import Link from 'next/link';
import { DataControls, PasswordForm, PreferencesForm } from '@/components/account/settings-forms';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';

export const metadata = { title: 'Account settings' };

export default async function SettingsPage() {
  await requireUser('/settings');
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Account settings"
        subtitle="Security, display preferences and privacy controls."
        actions={<Link href="/responsible-play" className="text-sm text-gold-400 hover:text-gold-300">Play limits →</Link>}
      />
      <div className="grid gap-6">
        <PasswordForm />
        <PreferencesForm />
        <DataControls />
      </div>
    </>
  );
}
