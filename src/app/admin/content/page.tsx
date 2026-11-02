import { CreateAnnouncement, ToggleAnnouncement } from '@/components/admin/engagement-controls';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { listAnnouncements } from '@/server/content/announcements';

export const metadata = { title: 'Content' };

export default async function AdminContentPage() {
  const session = await requirePermission('admin:access');
  const canManage = hasPermission(session.role, 'content:manage');
  const rows = await listAnnouncements();
  const now = Date.now();
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Content"
        subtitle="Announcements and banners on the home page and lobby. Plain text with an optional site link; every change is audited. Legal pages (terms, privacy, responsible play) are versioned in code and change only through a reviewed release."
      />
      <Card>
        <CardHeader title="Announcements" />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState title="No announcements" />
          ) : (
            <Table data-testid="announcements-admin">
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Where</Th>
                  <Th>Window</Th>
                  <Th>Status</Th>
                  {canManage && <Th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const live = a.active && a.startsAt.getTime() <= now && (!a.endsAt || a.endsAt.getTime() > now);
                  return (
                    <Tr key={a.id}>
                      <Td>
                        <span className="font-medium text-ink-100">{a.title}</span>
                        <div className="text-xs text-ink-400">{a.body}</div>
                      </Td>
                      <Td className="text-xs">{a.placement.toLowerCase()}</Td>
                      <Td className="text-xs text-ink-300">
                        {a.startsAt.toLocaleString()} – {a.endsAt ? a.endsAt.toLocaleString() : 'no end'}
                      </Td>
                      <Td>
                        <Badge tone={live ? 'positive' : 'neutral'}>{live ? 'live' : a.active ? 'scheduled / ended' : 'unpublished'}</Badge>
                      </Td>
                      {canManage && (
                        <Td className="text-right">
                          <ToggleAnnouncement id={a.id} active={a.active} />
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      {canManage && (
        <Card className="mt-6">
          <CardHeader title="New announcement" />
          <CardBody>
            <CreateAnnouncement />
          </CardBody>
        </Card>
      )}
    </>
  );
}
