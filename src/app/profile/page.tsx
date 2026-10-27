import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { Avatar } from '@/components/account/avatar';
import { GAME_NAMES } from '@/components/account/labels';
import { ProfileForm } from '@/components/account/profile-form';
import { summarizeRound } from '@/components/games/summaries';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, EmptyState, PageHeader, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { evaluateAchievements } from '@/server/achievements/achievements';
import { requireUser } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { listFavorites } from '@/server/games/favorites';
import { listRounds } from '@/server/games/round-service';
import { getWalletAccount } from '@/server/ledger/accounts';
import { userActivity } from '@/server/users/accounts';
import { accountDetails } from '@/server/users/onboarding';
import { playerStats } from '@/server/users/stats';

export const metadata = { title: 'Profile' };

const ACTIVITY_LABELS: Record<string, string> = {
  'user.registered': 'Account created',
  'user.profile_updated': 'Profile updated',
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
  'user.email_verified': 'E-mail address confirmed',
  'user.onboarding_completed': 'Profile completed',
  'user.details_updated': 'Personal details updated',
  'auth.verification_code_sent': 'Verification code sent',
  'auth.email_verification_failed': 'Incorrect verification code entered',
  'auth.signup_email_changed': 'Registration e-mail corrected',
  'auth.email_change_requested': 'E-mail change requested',
  'auth.email_change_cancelled': 'E-mail change cancelled',
  'auth.email_changed': 'E-mail address changed',
};

export default async function ProfilePage() {
  const session = await requireUser('/profile');
  const db = getDb();
  const [[user], wallet, stats, activity, achievements, favorites, rounds, details] = await Promise.all([
    db
      .select({ createdAt: users.createdAt, lastLoginAt: users.lastLoginAt, displayName: users.displayName, avatar: users.avatar })
      .from(users)
      .where(eq(users.id, session.userId)),
    getWalletAccount(db, session.userId),
    playerStats(session.userId),
    userActivity(session.userId, 15),
    evaluateAchievements(session.userId),
    listFavorites(session.userId),
    listRounds({ userId: session.userId, limit: 8 }),
    accountDetails(session.userId),
  ]);
  const fullName = [details.firstName, details.lastName].filter(Boolean).join(' ');
  const detailsComplete = Boolean(details.firstName && details.lastName && details.dateOfBirth && details.countryCode && details.phoneE164);
  const t = stats.totals;
  const name = user?.displayName ?? session.username;
  const earned = achievements.filter((a) => a.earned).length;
  return (
    <>
      <PageHeader
        eyebrow="Profile"
        title={
          <span className="flex items-center gap-4">
            <Avatar avatar={user?.avatar} name={name} className="size-14 text-lg" />
            <span data-testid="profile-name">{name}</span>
          </span>
        }
        subtitle={`${user?.displayName ? `@${session.username} · ` : ''}${session.email}`}
        actions={
          <>
            {session.role !== 'PLAYER' && <Badge tone="gold">{session.role.replace('_', ' ').toLowerCase()}</Badge>}
            <Link href="/settings" className="inline-flex h-10 items-center rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">
              Security & privacy
            </Link>
            <Link href="/responsible-play" className="inline-flex h-10 items-center rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">
              Play limits
            </Link>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Member since" value={user?.createdAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '—'} />
        <Stat label="Balance" value={<Chips amount={wallet?.balance ?? 0} />} tone="gold" sub="Virtual chips, no monetary value" />
        <Stat label="Rounds completed" value={t.rounds.toLocaleString()} sub={`${t.wins} won · ${t.losses} lost · ${t.draws} even`} />
        <Stat label="Net result" value={<Chips amount={t.net} sign colored />} sub="Returned minus staked" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Account details"
          subtitle="Private: never shown to other players."
          actions={
            <Link href="/settings" className="text-sm text-gold-400 hover:text-gold-300">
              Edit in settings →
            </Link>
          }
        />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">E-mail</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 break-all text-ink-100">
                {session.email}
                {details.emailVerificationMethod === 'LEGACY_MIGRATION' ? <Badge tone="warning">Not re-verified</Badge> : <Badge tone="positive">Verified</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Name</dt>
              <dd className="mt-1 text-ink-100" data-testid="profile-legal-name">{fullName || <span className="text-ink-400">Not provided</span>}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Country</dt>
              <dd className="mt-1 text-ink-100">{details.countryName ?? <span className="text-ink-400">Not provided</span>}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Phone</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-ink-100">
                {details.phoneDisplay ?? <span className="text-ink-400">Not provided</span>}
                {details.phoneDisplay && (details.phoneVerified ? <Badge tone="positive">Verified</Badge> : <Badge>Unverified</Badge>)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-ink-400">
            Profile {detailsComplete ? 'complete' : details.onboardingRequired ? 'incomplete' : 'details are optional for your account (it predates the profile step)'}.
            {details.onboardingCompletedAt && ` Completed ${details.onboardingCompletedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.`}
          </p>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Your results"
          subtitle="Staked is the total you put in (turnover), not a gain. Returned is everything paid back, including stakes. Only the net result shows whether you are up or down."
        />
        <CardBody className="space-y-6">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="surface-raised px-4 py-3">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Staked</dt>
              <dd className="mt-1 text-lg font-semibold">
                <Chips amount={t.wagered} />
              </dd>
            </div>
            <div className="surface-raised px-4 py-3">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Returned</dt>
              <dd className="mt-1 text-lg font-semibold">
                <Chips amount={t.paidOut} />
              </dd>
            </div>
            <div className="surface-raised px-4 py-3">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Net result</dt>
              <dd className="mt-1 text-lg font-semibold">
                <Chips amount={t.net} sign colored />
              </dd>
            </div>
          </dl>
          {stats.games.length === 0 ? (
            <EmptyState title="No completed rounds yet" action={<Link href="/lobby" className="text-sm text-gold-400">Browse the lobby →</Link>}>
              Your results per game will appear here.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Game</Th>
                  <Th className="text-right">Rounds</Th>
                  <Th className="text-right">Won / lost / even</Th>
                  <Th className="text-right">Staked</Th>
                  <Th className="text-right">Returned</Th>
                  <Th className="text-right">Net</Th>
                </tr>
              </thead>
              <tbody>
                {stats.games.map((g) => (
                  <Tr key={g.gameId}>
                    <Td className="font-medium text-ink-100">
                      <Link href={`/games/${g.gameId}`} className="hover:text-gold-300">
                        {GAME_NAMES[g.gameId] ?? g.gameId}
                      </Link>
                    </Td>
                    <Td className="num text-right">{g.rounds}</Td>
                    <Td className="num text-right">
                      {g.wins} / {g.losses} / {g.draws}
                    </Td>
                    <Td className="text-right">
                      <Chips amount={g.wagered} suffix={false} />
                    </Td>
                    <Td className="text-right">
                      <Chips amount={g.paidOut} suffix={false} />
                    </Td>
                    <Td className="text-right">
                      <Chips amount={g.net} sign colored suffix={false} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="text-xs text-ink-400">
            Detailed figures, including your realised return against each game&apos;s theoretical RTP, are on <Link href="/stats" className="text-gold-400">Statistics</Link>.
          </p>
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Achievements" subtitle={`${earned} of ${achievements.length} earned. Badges are cosmetic: they carry no chips, prizes or value.`} />
          <CardBody>
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="achievements">
              {achievements.map((a) => (
                <li key={a.id} className={a.earned ? 'surface-raised border-gold-700/60 px-4 py-3' : 'rounded-xl border border-dashed border-ink-700 px-4 py-3'} data-earned={a.earned}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={a.earned ? 'font-semibold text-gold-200' : 'font-semibold text-ink-300'}>{a.title}</span>
                    {a.earned ? <Badge tone="gold">Earned</Badge> : <Badge>Not yet</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-ink-400">{a.earned ? a.description : a.hint}</p>
                  {a.awardedAt && <p className="mt-1 text-[11px] text-ink-400">{new Date(a.awardedAt).toLocaleDateString()}</p>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Favourite games" />
            <CardBody>
              {favorites.length === 0 ? (
                <p className="text-sm text-ink-400">
                  No favourites yet. Use the star on a game in the <Link href="/lobby" className="text-gold-400">lobby</Link>.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {favorites.map((id) => (
                    <li key={id}>
                      <Link href={`/games/${id}`} className="inline-flex rounded-full border border-ink-600 px-3 py-1.5 text-sm text-ink-200 hover:border-gold-600">
                        {GAME_NAMES[id] ?? id}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent rounds" subtitle={<Link href="/history" className="text-gold-400">Full history →</Link>} />
            <CardBody className="pt-2">
              {rounds.length === 0 ? (
                <p className="text-sm text-ink-400">No rounds yet.</p>
              ) : (
                <ul className="divide-y divide-ink-800">
                  {rounds.map((r) => (
                    <li key={r.id}>
                      <Link href={`/history/${r.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-ink-850/60">
                        <span className="min-w-0 truncate text-ink-200">
                          <span className="text-ink-100">{GAME_NAMES[r.gameId] ?? r.gameId}</span> · {summarizeRound(r.gameId, r.summary, r.status)}
                        </span>
                        <span className="num shrink-0">{r.payout === null ? r.status.toLowerCase() : <Chips amount={r.payout - r.stake} sign colored suffix={false} />}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ProfileForm username={session.username} initial={{ displayName: user?.displayName ?? null, avatar: user?.avatar ?? null }} />
        <Card>
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
      </div>
    </>
  );
}
