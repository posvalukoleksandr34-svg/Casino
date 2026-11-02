import Link from 'next/link';
import { AccountTabs } from '@/components/account/account-tabs';
import { DevicesPanel } from '@/components/account/devices-panel';
import { MfaSettings } from '@/components/account/mfa-settings';
import { PasswordForm } from '@/components/account/settings-forms';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { mfaStatus } from '@/server/auth/mfa';
import { listDevices, signInHistory } from '@/server/users/devices';

export const metadata = { title: 'Security' };

const EVENT_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.account_locked': 'Account temporarily locked after failed attempts',
  'auth.mfa_failed': 'Wrong two-factor code',
  'auth.logout': 'Signed out',
  'auth.session_revoked': 'A device was signed out',
  'auth.other_sessions_revoked': 'All other devices were signed out',
};

export default async function SecurityPage() {
  const session = await requireUser('/settings/security');
  const [mfa, devices, history] = await Promise.all([mfaStatus(session.userId), listDevices(session.userId, session.sessionId), signInHistory(session.userId, 30)]);
  return (
    <>
      <PageHeader eyebrow="Account" title="Security" subtitle="Your password, two-factor authentication, the devices signed in to your account and your recent sign-ins." />
      <AccountTabs />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <PasswordForm />
        <MfaSettings enabled={mfa.enabled} sessionVerified={session.mfaVerifiedAt !== null} recoveryCodesLeft={mfa.recoveryCodesLeft} />
        <Card>
          <CardHeader title="Devices" subtitle="Every device signed in to your account. Sign out any you do not recognise, then change your password." />
          <CardBody>
            <DevicesPanel devices={devices} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sign-in history" subtitle="The last 30 sign-in events. Network addresses are stored only as keyed hashes, so none are shown." />
          <CardBody>
            {history.length === 0 ? (
              <p className="text-sm text-ink-400">No sign-in events yet.</p>
            ) : (
              <ul className="divide-y divide-white/[0.06] text-sm" data-testid="sign-in-history">
                {history.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
                    <span className={e.action === 'auth.login' ? 'text-ink-200' : 'text-warning'}>
                      {EVENT_LABELS[e.action] ?? e.action}
                      {e.mfa ? ' (with two-factor)' : ''}
                    </span>
                    <span className="text-xs text-ink-400">{new Date(e.at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-400">
              Something you do not recognise? <Link href="/support?topic=ACCOUNT" className="text-gold-300">Contact support</Link>.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
