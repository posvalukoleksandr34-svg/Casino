import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { TX_LABELS } from '@/components/account/labels';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, Mono, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { ledgerTransactionDetail } from '@/server/admin/wallet';
import { requirePermission } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { adminActions, users } from '@/server/db/schema';
import { AppError } from '@/server/errors';

export const metadata = { title: 'Ledger transaction' };

export default async function AdminLedgerTxPage({ params }: { params: Promise<{ transactionId: string }> }) {
  await requirePermission('ledger:read');
  const { transactionId } = await params;
  if (!/^\d{1,15}$/.test(transactionId)) notFound();
  const id = Number(transactionId);
  const d = await ledgerTransactionDetail(id).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const t = d.transaction;
  const db = getDb();
  const [player] = t.userId ? await db.select({ username: users.username }).from(users).where(eq(users.id, t.userId)) : [];
  const [actor] = t.actorId ? await db.select({ username: users.username }).from(users).where(eq(users.id, t.actorId)) : [];
  const action = await db
    .select({ id: adminActions.id, action: adminActions.action, reason: adminActions.reason, createdAt: adminActions.createdAt, auditLogId: adminActions.auditLogId })
    .from(adminActions)
    .where(sql`(${adminActions.after}->>'transactionId')::bigint = ${id}`)
    .limit(5);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/ledger" className="hover:text-gold-300">
            ← Virtual ledger
          </Link>
        }
        title={`Transaction #${t.id}`}
        subtitle={`${TX_LABELS[t.type] ?? t.type} · ${t.createdAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
        actions={d.balanced ? <Badge tone="positive">balanced</Badge> : <Badge tone="negative">unbalanced</Badge>}
      />
      {!d.balanced && (
        <Callout tone="negative" className="mb-6" title="Entries do not sum to zero">
          This should be impossible (a database trigger refuses unbalanced transactions). Run reconciliation and treat this as an incident.
        </Callout>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-400">Description</dt>
              <dd className="text-ink-100">{t.description}</dd>
              <dt className="text-ink-400">Player</dt>
              <dd>{t.userId ? <Link href={`/admin/users/${t.userId}`} className="text-gold-300">{player?.username ?? t.userId}</Link> : 'none (system)'}</dd>
              <dt className="text-ink-400">Initiated by</dt>
              <dd>{t.actorId ? <Link href={`/admin/users/${t.actorId}`} className="text-gold-300">{actor?.username ?? t.actorId}</Link> : 'the player or the system'}</dd>
              {t.roundId && (
                <>
                  <dt className="text-ink-400">Round</dt>
                  <dd>
                    <Link href={`/admin/rounds/${t.roundId}`} className="text-gold-300">
                      {t.roundId}
                    </Link>
                  </dd>
                </>
              )}
              {t.sportsTicketId && (
                <>
                  <dt className="text-ink-400">Prediction</dt>
                  <dd>
                    <Mono>{t.sportsTicketId}</Mono>
                  </dd>
                </>
              )}
              {t.reversesId && (
                <>
                  <dt className="text-ink-400">Corrects</dt>
                  <dd>
                    <Link href={`/admin/ledger/${t.reversesId}`} className="text-gold-300">
                      #{t.reversesId}
                    </Link>
                  </dd>
                </>
              )}
              <dt className="text-ink-400">Business key</dt>
              <dd>
                <Mono className="break-all text-xs">{t.idempotencyKey}</Mono>
              </dd>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Audited admin action" subtitle="Staff-initiated transactions carry one" />
          <CardBody className="text-sm">
            {action.length === 0 ? (
              <p className="text-ink-400">None: this transaction was not made by a staff action.</p>
            ) : (
              <ul className="space-y-2">
                {action.map((a) => (
                  <li key={a.id}>
                    <div className="text-ink-100">{a.action}</div>
                    <div className="text-xs text-ink-400">
                      {a.reason} · audit #{a.auditLogId}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Entries" subtitle="Append-only; each entry updates exactly one account balance" />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Balance after</Th>
                <Th className="text-right">Account seq.</Th>
              </tr>
            </thead>
            <tbody>
              {d.entries.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <span className="text-ink-200">{e.accountType.replace(/_/g, ' ').toLowerCase()}</span>
                    <div className="text-xs text-ink-400">{e.accountCode}</div>
                  </Td>
                  <Td className="text-right">
                    <Chips amount={e.amount} sign colored suffix={false} />
                  </Td>
                  <Td className="text-right">
                    {e.balanceAfter === null ? '—' : <Chips amount={e.balanceAfter} suffix={false} />}
                  </Td>
                  <Td className="num text-right text-ink-400">{e.accountSeq}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
