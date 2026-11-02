import { eq } from 'drizzle-orm';
import { AddUserNote } from '@/components/admin/user-notes';
import { listUserNotes } from '@/server/admin/notes';
import { hasPermission } from '@/server/auth/rbac';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { openRiskFlagCount } from '@/server/kyc/kyc';
import { listDeposits } from '@/server/payments/deposits';
import { listWithdrawals } from '@/server/payments/withdrawals';
import { bonusOverview } from '@/server/promotions/campaigns';
import { vipOverview } from '@/server/vip/vip';
import { walletSummary } from '@/server/wallet/wallet';
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
  const canKyc = hasPermission(session.role, 'kyc:review');
  const [notes, wallet, depositRows, withdrawalRows, vip, bonus, flags, [kycRow]] = await Promise.all([
    listUserNotes(userId),
    walletSummary(userId),
    listDeposits(userId, 20),
    listWithdrawals(userId, 20),
    vipOverview(userId),
    bonusOverview(userId),
    openRiskFlagCount(getDb(), userId),
    getDb().select({ kyc: users.kycStatus }).from(users).where(eq(users.id, userId)),
  ]);
  const kyc = kycRow?.kyc ?? 'NOT_STARTED';
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
              : [d.personal.dateOfBirth ? `Born ${d.personal.dateOfBirth} (${d.personal.age === 'provider_verified' ? 'age verified by provider' : 'self-declared'})` : null, d.personal.countryName, d.personal.phone ? `${d.personal.phone} (${d.personal.phoneVerified ? 'verified' : 'unverified'})` : null].filter(Boolean).join(' · ') || undefined
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
        <Card>
          <CardHeader title="Payments" subtitle="Deposits and withdrawals (sandbox provider)" actions={<Link href="/admin/payments" className="text-xs text-gold-400">Payments →</Link>} />
          <CardBody className="text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-ink-400">Deposited</dt>
                <dd>
                  <Chips amount={wallet.totals.deposited} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Withdrawn (incl. pending)</dt>
                <dd>
                  <Chips amount={wallet.totals.withdrawn} />
                </dd>
              </div>
            </dl>
            <ul className="mt-3 divide-y divide-white/[0.06]">
              {[...depositRows.slice(0, 5).map((d) => ({ id: d.id, at: d.createdAt, text: `Deposit ${(d.amount / 100).toFixed(2)} · ${d.status.toLowerCase().replace('_', ' ')}` })), ...withdrawalRows.slice(0, 5).map((w) => ({ id: w.id, at: w.requestedAt, text: `Withdrawal ${(w.amount / 100).toFixed(2)} · ${w.status.toLowerCase().replace('_', ' ')}` }))]
                .sort((a, b) => b.at.localeCompare(a.at))
                .slice(0, 8)
                .map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 py-1.5">
                    <span className="text-ink-200">{r.text}</span>
                    <span className="text-xs text-ink-400">{new Date(r.at).toLocaleDateString()}</span>
                  </li>
                ))}
              {depositRows.length + withdrawalRows.length === 0 && <li className="py-1.5 text-ink-400">No payments.</li>}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Verification, VIP and bonuses" actions={canKyc ? <Link href={`/admin/kyc/${userId}`} className="text-xs text-gold-400">Verification case →</Link> : undefined} />
          <CardBody className="text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-ink-400">Identity</dt>
                <dd>
                  <Badge tone={kyc === 'VERIFIED' ? 'positive' : kyc === 'REJECTED' ? 'negative' : 'neutral'}>{kyc.toLowerCase().replace('_', ' ')}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Open risk flags</dt>
                <dd>{flags > 0 ? <Badge tone="negative">{flags}</Badge> : 'none'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">VIP</dt>
                <dd>
                  {vip.current?.name} · {vip.points.toLocaleString()} points
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-400">Active bonus</dt>
                <dd>{bonus.active ? `${(bonus.active.amount / 100).toFixed(2)} · ${bonus.active.wageringProgress >= bonus.active.wageringRequired ? 'met' : `${((bonus.active.wageringProgress / Math.max(1, bonus.active.wageringRequired)) * 100).toFixed(0)}% wagered`}` : 'none'}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Internal notes" subtitle="Staff only, never shown to the player, cannot be edited or deleted." />
          <CardBody className="space-y-4 text-sm">
            {notes.length > 0 ? (
              <ul className="space-y-2" data-testid="user-notes">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                    <p className="whitespace-pre-wrap text-ink-100">{n.body}</p>
                    <p className="mt-1 text-xs text-ink-400">
                      {n.author} · {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-400">No notes.</p>
            )}
            {!self && <AddUserNote userId={userId} />}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
