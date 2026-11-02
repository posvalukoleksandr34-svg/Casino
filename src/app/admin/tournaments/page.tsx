import Link from 'next/link';
import { CancelTournament, CreateTournament } from '@/components/admin/engagement-controls';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { listGames } from '@/server/games/lobby';
import { listTournaments } from '@/server/tournaments/tournaments';

export const metadata = { title: 'Tournaments' };

export default async function AdminTournamentsPage() {
  const session = await requirePermission('admin:access');
  const canManage = hasPermission(session.role, 'promotions:manage');
  const [list, games] = await Promise.all([listTournaments(), listGames()]);
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Tournaments"
        subtitle="Scored from settled rounds after each player joins, by best multipliers (luck, not volume). Results are written once when the window ends; prizes become claimable rewards through the ledger. Every change is audited."
      />
      <Card>
        <CardHeader title="All tournaments" />
        <CardBody>
          {list.length === 0 ? (
            <EmptyState title="No tournaments yet" />
          ) : (
            <Table data-testid="admin-tournaments">
              <thead>
                <tr>
                  <Th>Tournament</Th>
                  <Th>Window</Th>
                  <Th className="text-right">Prize pool</Th>
                  <Th className="text-right">Entrants</Th>
                  <Th>Phase</Th>
                  {canManage && <Th />}
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <Tr key={t.id}>
                    <Td>
                      <Link href={`/tournaments/${t.slug}`} className="font-medium text-ink-100 hover:text-gold-300">
                        {t.name}
                      </Link>
                      <div className="text-xs text-ink-400">
                        {t.metricLabel}
                        {t.minVipLevel > 1 && ` · VIP ${t.minVipLevel}+`}
                      </div>
                    </Td>
                    <Td className="text-xs text-ink-300">
                      {new Date(t.startsAt).toLocaleString()} – {new Date(t.endsAt).toLocaleString()}
                    </Td>
                    <Td className="text-right">
                      <Chips amount={t.prizePool} suffix={false} />
                    </Td>
                    <Td className="num text-right">{t.entrants}</Td>
                    <Td>
                      <Badge tone={t.phase === 'RUNNING' ? 'positive' : t.phase === 'CANCELLED' ? 'negative' : 'neutral'}>{t.phase.toLowerCase()}</Badge>
                    </Td>
                    {canManage && <Td className="text-right">{(t.phase === 'UPCOMING' || t.phase === 'RUNNING' || t.phase === 'ENDED') && <CancelTournament id={t.id} />}</Td>}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      {canManage && (
        <Card className="mt-6">
          <CardHeader title="New tournament" />
          <CardBody>
            <CreateTournament games={games.map((g) => ({ id: g.id, name: g.name }))} />
          </CardBody>
        </Card>
      )}
    </>
  );
}
