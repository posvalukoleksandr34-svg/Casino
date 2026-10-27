import Link from 'next/link';
import { CursorPagination, FilterBar, FilterField, filterInputClass, type Params } from '@/components/admin/list-controls';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Callout, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { listAudit } from '@/server/admin/admin-service';
import { dateRange } from '@/server/admin/period';
import { requirePermission } from '@/server/auth/current';
import { AppError } from '@/server/errors';

export const metadata = { title: 'Audit log' };

const OUTCOMES = ['SUCCESS', 'DENIED', 'FAILED'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermission('audit:read');
  const sp = await searchParams;
  const outcome = OUTCOMES.includes(sp.outcome as never) ? (sp.outcome as (typeof OUTCOMES)[number]) : undefined;
  const actor = sp.actor?.trim().slice(0, 40);
  let problem: string | null = null;
  let range: { from?: Date; to?: Date } = {};
  try {
    range = dateRange({ from: sp.from, to: sp.to });
  } catch (err) {
    problem = err instanceof AppError ? err.message : 'Invalid date range';
  }
  const before = sp.before && /^\d{1,15}$/.test(sp.before) ? Number(sp.before) : undefined;
  const { items, nextBefore } = await listAudit({
    action: sp.action?.slice(0, 60) || undefined,
    actorId: actor && UUID.test(actor) ? actor : undefined,
    actorName: actor && !UUID.test(actor) ? actor : undefined,
    resourceId: sp.resource?.slice(0, 100) || undefined,
    outcome,
    ...range,
    before,
    limit: 100,
  });
  const params: Params = { action: sp.action, actor: sp.actor, resource: sp.resource, outcome, from: sp.from, to: sp.to };
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        subtitle="Append-only for the application (database triggers refuse updates, deletes and truncation). Staff changes record the actor, their role, time, target, previous and new values, reason and request id. Secrets, passwords, tokens and request bodies are never logged."
      />
      <FilterBar action="/admin/audit" resetHref="/admin/audit">
        <FilterField label="Action prefix" htmlFor="audit-action">
          <input id="audit-action" name="action" defaultValue={sp.action ?? ''} placeholder="e.g. user. or auth.login" className={`${filterInputClass} w-52`} />
        </FilterField>
        <FilterField label="Actor (username or id)" htmlFor="audit-actor">
          <input id="audit-actor" name="actor" defaultValue={sp.actor ?? ''} className={`${filterInputClass} w-52`} />
        </FilterField>
        <FilterField label="Target id" htmlFor="audit-resource">
          <input id="audit-resource" name="resource" defaultValue={sp.resource ?? ''} className={`${filterInputClass} w-52`} />
        </FilterField>
        <FilterField label="Outcome" htmlFor="audit-outcome">
          <select id="audit-outcome" name="outcome" defaultValue={outcome ?? ''} className={filterInputClass}>
            <option value="">Any</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o.toLowerCase()}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From (UTC)" htmlFor="audit-from">
          <input id="audit-from" name="from" type="date" defaultValue={sp.from ?? ''} className={filterInputClass} />
        </FilterField>
        <FilterField label="To (UTC)" htmlFor="audit-to">
          <input id="audit-to" name="to" type="date" defaultValue={sp.to ?? ''} className={filterInputClass} />
        </FilterField>
      </FilterBar>
      {problem && (
        <Callout tone="warning" className="mb-4">
          {problem} The date filter was ignored.
        </Callout>
      )}
      <Card>
        <CardBody>
          {items.length === 0 ? (
            <EmptyState title="No audit entries match these filters" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Time (UTC)</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Target</Th>
                  <Th>Change</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <Tr key={a.id}>
                    <Td className="num text-xs text-ink-400">{a.id}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-400">{a.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                    <Td className="text-xs">
                      {a.actorId ? (
                        <Link href={`/admin/users/${a.actorId}`} className="hover:text-gold-300">
                          {a.actorName ?? a.actorId.slice(0, 8)}
                        </Link>
                      ) : (
                        a.actorType.toLowerCase()
                      )}
                      <div className="text-ink-400">{a.actorRole ? a.actorRole.toLowerCase().replace('_', ' ') : a.actorType.toLowerCase()}</div>
                    </Td>
                    <Td className="text-xs">
                      <span className="font-mono">{a.action}</span>
                      {a.outcome !== 'SUCCESS' && (
                        <div className="mt-1">
                          <Badge tone={a.outcome === 'DENIED' ? 'warning' : 'negative'}>{a.outcome.toLowerCase()}</Badge>
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs">{a.resourceType ? `${a.resourceType}:${a.resourceId?.slice(0, 12) ?? ''}` : '—'}</Td>
                    <Td className="max-w-xs text-xs">
                      {(a.before !== null || a.after !== null || Object.keys(a.metadata ?? {}).length > 0) && (
                        <details>
                          <summary className="cursor-pointer text-ink-300">details</summary>
                          <pre className="mt-1 overflow-x-auto text-[11px] text-ink-400">{JSON.stringify({ before: a.before, after: a.after, metadata: a.metadata, requestId: a.requestId }, null, 2)}</pre>
                        </details>
                      )}
                    </Td>
                    <Td className="max-w-xs text-xs text-ink-300">{a.reason ?? ''}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <CursorPagination basePath="/admin/audit" params={params} nextBefore={nextBefore} isFirstPage={!before} />
        </CardBody>
      </Card>
    </>
  );
}
