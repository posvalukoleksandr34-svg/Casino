import Link from 'next/link';
import { ApprovalActions } from '@/components/admin/approval-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { APPROVAL_TTL_HOURS, listApprovals } from '@/server/admin/approvals';
import { GRANT_APPROVAL_THRESHOLD } from '@/server/admin/wallet';
import { requirePermission } from '@/server/auth/current';
import { ROLE_LABELS } from '@/server/auth/rbac';
import type { UserRole } from '@/server/db/schema';

export const metadata = { title: 'Approvals' };

const TONE: Record<string, 'warning' | 'positive' | 'negative' | 'info' | undefined> = { PENDING: 'warning', EXECUTED: 'positive', REJECTED: 'negative', FAILED: 'negative', EXPIRED: undefined, CANCELLED: undefined };

function utc(d: Date | null) {
  return d ? `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';
}

function describe(r: { action: string; params: Record<string, unknown>; targetName: string | null; targetId: string }) {
  const amount = typeof r.params.amount === 'number' ? r.params.amount : null;
  switch (r.action) {
    case 'ledger.grant':
      return <>Grant <Chips amount={amount ?? 0} /> to {r.targetName ?? r.targetId}</>;
    case 'ledger.adjustment':
      return (
        <>
          Correction of <Chips amount={amount ?? 0} sign /> for {r.targetName ?? r.targetId}
          {r.params.reversesTransactionId ? ` (reverses transaction #${String(r.params.reversesTransactionId)})` : ''}
        </>
      );
    case 'house.fund':
      return <>Issue <Chips amount={amount ?? 0} /> to the house reserve</>;
    default:
      return <>Stop requiring two-factor authentication for staff</>;
  }
}

/**
 * Four-eyes requests: large grants, every balance correction, house funding
 * and switching off the staff MFA policy wait here for a second authorised
 * staff member. Requesters see their own; deciders see what they may decide.
 */
export default async function ApprovalsPage() {
  const session = await requirePermission('admin:access');
  const rows = await listApprovals(session);
  const open = rows.filter((r) => r.status === 'PENDING');
  const closed = rows.filter((r) => r.status !== 'PENDING').slice(0, 50);
  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Approvals"
        subtitle={`Sensitive operations need a second authorised staff member: grants above ${(GRANT_APPROVAL_THRESHOLD / 100).toLocaleString('en-US')} chips, every balance correction, house funding, and switching off the staff MFA requirement. Nobody can approve their own request; requests expire after ${APPROVAL_TTL_HOURS} hours; approval executes the operation once, atomically.`}
      />
      <Card>
        <CardHeader title={`Waiting for a decision (${open.length})`} />
        <CardBody>
          {open.length === 0 ? (
            <EmptyState title="Nothing waiting">Requests appear here when a grant, correction, house funding or MFA policy change is submitted.</EmptyState>
          ) : (
            <ul className="divide-y divide-ink-800" data-testid="approvals-open">
              {open.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="warning">{r.actionLabel}</Badge>
                      <span className="text-ink-100">{describe(r)}</span>
                    </div>
                    <p className="text-ink-300">“{r.reason}”</p>
                    <p className="text-xs text-ink-400">
                      Requested by {r.requesterName} ({ROLE_LABELS[r.requestedRole as UserRole] ?? r.requestedRole}) · {utc(r.requestedAt)} · expires {utc(r.expiresAt)}
                      {r.targetType === 'user' && (
                        <>
                          {' · '}
                          <Link href={`/admin/users/${r.targetId}`} className="text-gold-400">
                            View account
                          </Link>
                        </>
                      )}
                    </p>
                    {!r.canDecide && !r.canCancel && <p className="text-xs text-ink-400">You cannot decide this request.</p>}
                    {r.requestedBy === session.userId && <p className="text-xs text-ink-400">Your request: another authorised staff member must decide it.</p>}
                  </div>
                  <ApprovalActions id={r.id} summary={`${r.actionLabel} — “${r.reason}”`} canDecide={r.canDecide} canCancel={r.canCancel} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Recent decisions" subtitle="Executed, rejected, failed, cancelled and expired requests" />
        <CardBody>
          {closed.length === 0 ? (
            <p className="text-sm text-ink-400">No decided requests yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Request</Th>
                  <Th>Status</Th>
                  <Th>Requested by</Th>
                  <Th>Decided by</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {closed.map((r) => (
                  <Tr key={r.id}>
                    <Td className="text-sm">
                      <div className="text-ink-100">{describe(r)}</div>
                      <div className="text-xs text-ink-400">“{r.reason}”{r.decisionNote ? ` · note: “${r.decisionNote}”` : ''}</div>
                      {r.status === 'FAILED' && r.result && <div className="text-xs text-negative">{String(r.result.message ?? '')}</div>}
                    </Td>
                    <Td>
                      <Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                    </Td>
                    <Td className="text-xs">{r.requesterName}</Td>
                    <Td className="text-xs">{r.deciderName ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-400">{utc(r.decidedAt ?? r.expiresAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
