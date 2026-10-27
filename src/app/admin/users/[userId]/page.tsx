import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Avatar } from '@/components/account/avatar';
import { GAME_NAMES, TX_LABELS } from '@/components/account/labels';
import { UserActions } from '@/components/admin/user-actions';
import { summarizeRound } from '@/components/games/summaries';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, EmptyState, PageHeader, Pct, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { userDetail } from '@/server/admin/users';
import { MAX_GRANT } from '@/server/admin/wallet';
import { requirePermission } from '@/server/auth/current';
import { AppError } from '@/server/errors';

export const metadata = { title: 'User' };

function utc(d: Date | string | null | undefined) {
  return d ? `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';
}

const ACTION_LABELS: Record<string, string> = {
  'user.suspended': 'Suspended',
  'user.reinstated': 'Reinstated',
  'user.status': 'Status changed',
  'user.role': 'Role changed',
  'user.sessions_revoked': 'Signed out everywhere',
  'ledger.grant': 'Test chips granted',
  'ledger.adjustment': 'Balance correction',
};

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requirePermission('users:read');
  const { userId } = await params;
  if (!z.uuid().safeParse(userId).success) notFound();
  const d = await userDetail(userId, { role: session.role }).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const self = session.userId === userId;
  const t = d.stats.totals;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/users" className="hover:text-gold-300">
            ← Users
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar avatar={d.user.avatar} name={d.user.displayName ?? d.user.username} className="size-11" />
            <span>{d.user.displayName ?? d.user.username}</span>
          </span>
        }
        subtitle={`${d.user.displayName ? `${d.user.username} · ` : ''}${d.user.email} · id ${d.user.id}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {d.user.role !== 'PLAYER' && <Badge tone="gold">{d.user.roleLabel}</Badge>}
            <StatusBadge status={d.user.status} />
            {!self && <UserActions userId={userId} status={d.user.status} role={d.user.role} allowed={d.allowed} maxGrantChips={MAX_GRANT / 100} />}
          </div>
        }
      />
      {self && (
        <Callout tone="info" className="mb-6">
          This is your own account. Status, role and balance changes to your own account are not available here.
        </Callout>
      )}
      {d.user.status !== 'ACTIVE' && d.user.statusReason && (
        <Callout tone="warning" className="mb-6" title={`Account ${d.user.status.toLowerCase()}`}>
          {d.user.statusReason}
        </Callout>
      )}
      {!d.ledgerCheck.matches && (
        <Callout tone="negative" className="mb-6" title="Balance does not match the ledger">
          The stored wallet balance differs from the sum of its ledger entries (<Chips amount={d.ledgerCheck.entriesSum} />). Run reconciliation and investigate before any correction.
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Virtual balance" value={<Chips amount={d.balance} />} tone="gold" sub={d.ledgerCheck.matches ? 'Matches its ledger entries' : 'Ledger mismatch'} />
        <Stat label="Rounds" value={t.rounds.toLocaleString()} sub={`${t.wins} won · ${t.losses} lost · ${t.draws} even`} />
        <Stat label="Wagered / returned" value={<Chips amount={t.wagered} compact />} sub={<>Returned <Chips amount={t.paidOut} compact suffix={false} /> · RTP <Pct value={t.wagered ? t.paidOut / t.wagered : null} /></>} />
        <Stat label="Net result (casino)" value={<Chips amount={t.net} sign colored />} sub="Returned − wagered (virtual)" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Predictions" value={d.sports.tickets.toLocaleString()} sub={`${d.sports.open} open · ${d.sports.won} won · ${d.sports.lost} lost · ${d.sports.voided} void`} />
        <Stat label="Prediction net" value={<Chips amount={d.sports.net} sign colored />} sub={<>Staked <Chips amount={d.sports.staked} compact suffix={false} /></>} />
        <Stat label="Registered" value={d.user.createdAt.toISOString().slice(0, 10)} sub={`Last sign-in ${utc(d.user.lastLoginAt)}`} />
        <Stat
          label="Registration"
          value={d.lifecycle === 'awaiting_verification' ? 'Awaiting e-mail code' : d.lifecycle === 'profile_pending' ? 'Profile pending' : 'Complete'}
          sub={
            d.user.emailVerificationMethod === 'LEGACY_MIGRATION'
              ? 'E-mail assumed verified (account predates verification)'
              : d.user.emailVerifiedAt
                ? `E-mail verified ${utc(d.user.emailVerifiedAt)}${d.user.emailVerificationMethod === 'OPERATOR' ? ' (operator-created)' : ''}`
                : 'No wallet, session or chips until verified'
          }
        />
        <Stat
          label="Personal details"
          value={'provided' in d.personal ? (d.personal.provided ? 'On file' : 'Not provided') : [d.personal.firstName, d.personal.lastName].filter(Boolean).join(' ') || 'Not provided'}
          sub={
            'provided' in d.personal
              ? 'Visible to roles with personal-data access'
              : [d.personal.dateOfBirth ? `Born ${d.personal.dateOfBirth}` : null, d.personal.countryName, d.personal.phone ? `${d.personal.phone} (${d.personal.phoneVerified ? 'verified' : 'unverified'})` : null].filter(Boolean).join(' · ') || undefined
          }
        />
        <Stat label="Sign-in security" value={d.mfaEnabled ? 'MFA on' : 'Password only'} sub={`${d.user.failedLoginCount} failed attempts${d.user.lockedUntil && d.user.lockedUntil > new Date() ? ` · locked until ${utc(d.user.lockedUntil)}` : ''}`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent rounds" actions={<Link href={`/admin/rounds?userId=${userId}`} className="text-xs text-gold-400">All →</Link>} />
          <CardBody>
            {d.recentRounds.length === 0 ? (
              <EmptyState title="No rounds yet" />
            ) : (
              <Table>
                <tbody>
                  {d.recentRounds.map((r) => (
                    <Tr key={r.id}>
                      <Td className="whitespace-nowrap text-xs text-ink-400">
                        <Link href={`/admin/rounds/${r.id}`} className="hover:text-gold-300">
                          {utc(r.startedAt)}
                        </Link>
                      </Td>
                      <Td>{GAME_NAMES[r.gameId]}</Td>
                      <Td className="text-xs">{summarizeRound(r.gameId, r.summary, r.status)}</Td>
                      <Td className="text-right">{r.payout === null ? <StatusBadge status={r.status} /> : <Chips amount={r.payout - r.stake} sign colored suffix={false} />}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent wallet entries" actions={<Link href={`/admin/ledger?userId=${userId}`} className="text-xs text-gold-400">Ledger →</Link>} />
          <CardBody>
            {d.recentTransactions.length === 0 ? (
              <EmptyState title="No transactions" />
            ) : (
              <Table>
                <tbody>
                  {d.recentTransactions.map((x) => (
                    <Tr key={x.entryId}>
                      <Td className="whitespace-nowrap text-xs text-ink-400">{utc(x.createdAt)}</Td>
                      <Td>{TX_LABELS[x.type] ?? x.type}</Td>
                      <Td className="num text-xs text-ink-400">
                        <Link href={`/admin/ledger/${x.transactionId}`} className="hover:text-gold-300">
                          #{x.transactionId}
                        </Link>
                      </Td>
                      <Td className="text-right">
                        <Chips amount={x.amount} sign colored suffix={false} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Administrative history" subtitle="Every staff action on this account, with its reason" />
          <CardBody>
            {d.adminHistory.length === 0 ? (
              <p className="text-sm text-ink-400">No staff actions on this account.</p>
            ) : (
              <ul className="max-h-80 divide-y divide-ink-800 overflow-y-auto text-sm">
                {d.adminHistory.map((a) => (
                  <li key={a.id} className="py-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-ink-100">{ACTION_LABELS[a.action] ?? a.action}</span>
                      <span className="whitespace-nowrap text-xs text-ink-400">{utc(a.createdAt)}</span>
                    </div>
                    <div className="text-xs text-ink-400">
                      by {a.adminName} — {a.reason}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Security events" subtitle="Sign-ins, failures, MFA and account changes by the account itself" />
          <CardBody>
            {d.security.length === 0 ? (
              <p className="text-sm text-ink-400">No events recorded.</p>
            ) : (
              <ul className="max-h-80 divide-y divide-ink-800 overflow-y-auto text-sm">
                {d.security.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3 py-2">
                    <span className={e.outcome === 'SUCCESS' ? 'text-ink-200' : 'text-warning'}>
                      {e.action}
                      {e.outcome !== 'SUCCESS' && <span className="ml-2 text-xs">({e.outcome.toLowerCase()})</span>}
                    </span>
                    <span className="whitespace-nowrap text-xs text-ink-400">{utc(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sessions" subtitle="Most recent 10" />
          <CardBody>
            {d.sessions.length === 0 ? (
              <p className="text-sm text-ink-400">No sessions.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Started</Th>
                    <Th>Last seen</Th>
                    <Th>State</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.sessions.map((s) => (
                    <Tr key={s.id}>
                      <Td className="whitespace-nowrap text-xs text-ink-300">{utc(s.createdAt)}</Td>
                      <Td className="whitespace-nowrap text-xs text-ink-300">{utc(s.lastSeenAt)}</Td>
                      <Td className="text-xs">
                        {s.revokedAt ? 'revoked' : s.expiresAt < new Date() ? 'expired' : 'live'}
                        {s.mfaVerifiedAt && <span className="ml-1 text-ink-400">· MFA</span>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Responsible-play settings" subtitle="Set by the player; staff cannot loosen them." />
          <CardBody className="text-sm">
            {d.responsibleLimits ? (
              <dl className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['24 h loss limit', d.responsibleLimits.dailyLossLimit],
                    ['7 d loss limit', d.responsibleLimits.weeklyLossLimit],
                    ['24 h wager limit', d.responsibleLimits.dailyWagerLimit],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-ink-400">{k}</dt>
                    <dd>{v ? <Chips amount={v} /> : 'none'}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-ink-400">Session limit</dt>
                  <dd>{d.responsibleLimits.sessionLimitMinutes ? `${d.responsibleLimits.sessionLimitMinutes} min` : 'none'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">Cool-off until</dt>
                  <dd>{utc(d.responsibleLimits.coolOffUntil)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">Self-excluded until</dt>
                  <dd>{utc(d.responsibleLimits.selfExcludedUntil)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-ink-400">No limits set.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
