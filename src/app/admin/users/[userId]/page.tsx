import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { GAME_NAMES, TX_LABELS } from '@/components/account/labels';
import { UserActions } from '@/components/admin/user-actions';
import { summarizeRound } from '@/components/games/summaries';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader, Pct, Stat } from '@/components/ui/misc';
import { Table, Td, Tr } from '@/components/ui/table';
import { userDetail } from '@/server/admin/admin-service';
import { hasPermission } from '@/server/auth/rbac';
import { requirePermission } from '@/server/auth/current';
import { AppError } from '@/server/errors';

export const metadata = { title: 'User' };

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await requirePermission('users:read');
  const { userId } = await params;
  if (!z.uuid().safeParse(userId).success) notFound();
  const d = await userDetail(userId).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const self = session.userId === userId;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/users" className="hover:text-gold-300">← Users</Link>}
        title={d.user.username}
        subtitle={`${d.user.email} · ${d.user.id}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.user.status} />
            {!self && (
              <UserActions
                userId={userId}
                status={d.user.status}
                role={d.user.role}
                can={{ suspend: hasPermission(session.role, 'users:suspend'), roles: hasPermission(session.role, 'roles:manage'), adjust: hasPermission(session.role, 'ledger:adjust') }}
              />
            )}
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Balance" value={<Chips amount={d.balance} />} tone="gold" />
        <Stat label="Rounds" value={d.stats.totals.rounds.toLocaleString()} sub={`Role ${d.user.role}`} />
        <Stat label="Wagered" value={<Chips amount={d.stats.totals.wagered} />} />
        <Stat label="Net result" value={<Chips amount={d.stats.totals.net} sign colored />} sub={<>Realised RTP <Pct value={d.stats.totals.wagered ? d.stats.totals.paidOut / d.stats.totals.wagered : null} /></>} />
      </div>
      {d.user.statusReason && <p className="mt-3 text-sm text-ink-400">Status reason: {d.user.statusReason}</p>}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent rounds" actions={<Link href={`/admin/rounds?userId=${userId}`} className="text-xs text-gold-400">All →</Link>} />
          <CardBody>
            <Table>
              <tbody>
                {d.recentRounds.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap text-xs text-ink-400">
                      <Link href={`/admin/rounds/${r.id}`} className="hover:text-gold-300">
                        {new Date(r.startedAt).toLocaleString()}
                      </Link>
                    </Td>
                    <Td>{GAME_NAMES[r.gameId]}</Td>
                    <Td className="text-xs">{summarizeRound(r.gameId, r.summary, r.status)}</Td>
                    <Td className="text-right">{r.payout === null ? <StatusBadge status={r.status} /> : <Chips amount={r.payout - r.stake} sign colored suffix={false} />}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent transactions" />
          <CardBody>
            <Table>
              <tbody>
                {d.recentTransactions.map((t) => (
                  <Tr key={t.entryId}>
                    <Td className="whitespace-nowrap text-xs text-ink-400">{new Date(t.createdAt).toLocaleString()}</Td>
                    <Td>{TX_LABELS[t.type] ?? t.type}</Td>
                    <Td className="num text-xs text-ink-400">#{t.transactionId}</Td>
                    <Td className="text-right"><Chips amount={t.amount} sign colored suffix={false} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Responsible-play settings" subtitle="Set by the player; staff cannot loosen them." />
          <CardBody className="text-sm">
            {d.responsibleLimits ? (
              <dl className="grid grid-cols-2 gap-3">
                {[
                  ['24 h loss limit', d.responsibleLimits.dailyLossLimit],
                  ['7 d loss limit', d.responsibleLimits.weeklyLossLimit],
                  ['24 h wager limit', d.responsibleLimits.dailyWagerLimit],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-xs text-ink-400">{k}</dt>
                    <dd>{v ? <Chips amount={v as number} /> : 'none'}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-ink-400">Session limit</dt>
                  <dd>{d.responsibleLimits.sessionLimitMinutes ? `${d.responsibleLimits.sessionLimitMinutes} min` : 'none'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">Cool-off until</dt>
                  <dd>{d.responsibleLimits.coolOffUntil?.toLocaleString() ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-400">Self-excluded until</dt>
                  <dd>{d.responsibleLimits.selfExcludedUntil?.toLocaleDateString() ?? '—'}</dd>
                </div>
              </dl>
            ) : (
              'No settings'
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Account activity" />
          <CardBody>
            <ul className="max-h-80 divide-y divide-ink-800 overflow-y-auto text-sm">
              {d.activity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-2">
                  <span className="text-ink-200">
                    {a.action}
                    {a.reason && <span className="text-ink-400"> — {a.reason}</span>}
                  </span>
                  <span className="whitespace-nowrap text-xs text-ink-400">{a.createdAt.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
