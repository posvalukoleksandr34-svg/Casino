import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { requireUser } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { getWalletAccount } from '@/server/ledger/accounts';
import { userActivity } from '@/server/users/accounts';
import { playerStats } from '@/server/users/stats';
import { eq } from 'drizzle-orm';

export const metadata = { title: 'Profile' };

const ACTIVITY_LABELS: Record<string, string> = {
  'user.registered': 'Account created',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Failed sign-in attempt',
  'auth.account_locked': 'Account temporarily locked',
  'auth.password_changed': 'Password changed',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset': 'Password reset',
  'bonus.daily_claimed': 'Daily chips claimed',
  'fairness.seed_rotated': 'Provably fair seed rotated',
  'responsible.limits_updated': 'Play limits updated',
  'responsible.cool_off': 'Cool-off started',
  'responsible.self_excluded': 'Self-exclusion started',
  'user.data_exported': 'Personal data exported',
};

export default async function ProfilePage() {
  const session = await requireUser('/profile');
  const db = getDb();
  const [[user], wallet, stats, activity] = await Promise.all([
    db.select({ createdAt: users.createdAt, lastLoginAt: users.lastLoginAt }).from(users).where(eq(users.id, session.userId)),
    getWalletAccount(db, session.userId),
    playerStats(session.userId),
    userActivity(session.userId, 30),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Profile"
        title={session.username}
        subtitle={session.email}
        actions={
          <>
            {session.role !== 'PLAYER' && <Badge tone="gold">{session.role.replace('_', ' ').toLowerCase()}</Badge>}
            <Link href="/settings" className="inline-flex h-10 items-center rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">
              Account settings
            </Link>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Member since" value={user?.createdAt.toLocaleDateString() ?? '—'} />
        <Stat label="Balance" value={<Chips amount={wallet?.balance ?? 0} />} tone="gold" />
        <Stat label="Rounds played" value={stats.totals.rounds.toLocaleString()} />
        <Stat label="Net result" value={<Chips amount={stats.totals.net} sign colored />} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Account activity" subtitle="Security-relevant events on your account. Contact support if anything looks unfamiliar." />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Event</Th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-ink-400">{a.createdAt.toLocaleString()}</Td>
                  <Td>{ACTIVITY_LABELS[a.action] ?? a.action}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
