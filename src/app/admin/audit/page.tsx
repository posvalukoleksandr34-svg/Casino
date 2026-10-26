import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { listAudit } from '@/server/admin/admin-service';
import { requirePermission } from '@/server/auth/current';

export const metadata = { title: 'Audit log' };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; before?: string; resource?: string }> }) {
  await requirePermission('audit:read');
  const sp = await searchParams;
  const items = await listAudit({ action: sp.action || undefined, resourceId: sp.resource || undefined, before: sp.before ? Number(sp.before) : undefined, limit: 100 });
  const last = items[items.length - 1];
  return (
    <>
      <PageHeader eyebrow="Admin" title="Audit log" subtitle="Append-only (enforced by database triggers). Administrative changes include the actor, time, target, previous value, new value and reason." />
      <form className="mb-4 flex flex-wrap gap-2" action="/admin/audit">
        <Input name="action" defaultValue={sp.action ?? ''} placeholder="Action prefix, e.g. game. or auth.login" aria-label="Action prefix" className="max-w-xs" />
        <Input name="resource" defaultValue={sp.resource ?? ''} placeholder="Resource id" aria-label="Resource id" className="max-w-xs" />
        <button className="h-11 rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">Filter</button>
      </form>
      <Card>
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Time</Th>
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
                  <Td className="whitespace-nowrap text-xs text-ink-400">{a.createdAt.toLocaleString()}</Td>
                  <Td className="text-xs">
                    {a.actorId ? <Link href={`/admin/users/${a.actorId}`} className="hover:text-gold-300">{a.actorName ?? a.actorId.slice(0, 8)}</Link> : a.actorType.toLowerCase()}
                    <div className="text-ink-400">{a.actorType}</div>
                  </Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-xs">{a.resourceType ? `${a.resourceType}:${a.resourceId?.slice(0, 12) ?? ''}` : '—'}</Td>
                  <Td className="max-w-xs text-xs">
                    {(a.before !== null || a.after !== null) && (
                      <details>
                        <summary className="cursor-pointer text-ink-300">before → after</summary>
                        <pre className="mt-1 overflow-x-auto text-[11px] text-ink-400">{JSON.stringify({ before: a.before, after: a.after }, null, 2)}</pre>
                      </details>
                    )}
                  </Td>
                  <Td className="max-w-xs text-xs text-ink-300">{a.reason ?? ''}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {last && items.length === 100 && (
            <div className="mt-4 text-right">
              <Link href={`/admin/audit?before=${last.id}${sp.action ? `&action=${encodeURIComponent(sp.action)}` : ''}`} className="text-sm text-gold-400">
                Older →
              </Link>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
