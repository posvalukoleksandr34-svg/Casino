import { HistoryTable } from '@/components/account/history-table';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { catalogEntries } from '@/server/games/catalog';

export const metadata = { title: 'Game history' };

export default async function HistoryPage() {
  await requireUser('/history');
  return (
    <>
      <PageHeader eyebrow="History" title="Game history" subtitle="Every round, its outcome and the provably fair inputs used to produce it. Open a round to verify it." />
      <Card>
        <CardBody>
          <HistoryTable games={catalogEntries().map((c) => c.id)} />
        </CardBody>
      </Card>
    </>
  );
}
