import Link from 'next/link';
import { desc, eq, gte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { SportsEventActions } from '@/components/admin/sports-actions';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { getDb } from '@/server/db/client';
import { sportsEvents, sportsTeams } from '@/server/db/schema';
import { sportsConfig } from '@/server/sports/config';
import { providerHealth } from '@/server/sports/queries';

export const metadata = { title: 'Sports' };

const home = alias(sportsTeams, 'home');
const away = alias(sportsTeams, 'away');

export default async function AdminSportsPage() {
  const session = await requirePermission('admin:access');
  const canManage = hasPermission(session.role, 'sports:manage');
  const cfg = sportsConfig();
  const [health, events, liability] = await Promise.all([
    providerHealth(),
    getDb()
      .select({ e: sportsEvents, home: home.name, away: away.name })
      .from(sportsEvents)
      .innerJoin(home, eq(home.id, sportsEvents.homeTeamId))
      .innerJoin(away, eq(away.id, sportsEvents.awayTeamId))
      .where(gte(sportsEvents.kickoffAt, new Date(Date.now() - 2 * 86_400_000)))
      .orderBy(desc(sportsEvents.kickoffAt))
      .limit(60),
    getDb().execute<{ open: number; stake: string; liability: string }>(
      sql`SELECT count(*)::int AS open, coalesce(sum(stake), 0)::text AS stake, coalesce(sum(potential_return - stake), 0)::text AS liability
          FROM sports_tickets WHERE status IN ('ACCEPTED', 'SUSPENDED')`,
    ),
  ]);
  const l = liability.rows[0]!;
  const now = new Date();
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Sports predictions"
        subtitle={`Mode: ${cfg.mode}${cfg.misconfigured ? ' (live selected but provider keys are missing — no events offered)' : ''}. Results, voids and suspensions are audited; corrections only ever credit players.`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Open predictions" />
          <CardBody className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-ink-400">Tickets</div>
              <div className="num text-xl">{l.open}</div>
            </div>
            <div>
              <div className="text-xs text-ink-400">Stakes held</div>
              <Chips amount={Number(l.stake)} />
            </div>
            <div>
              <div className="text-xs text-ink-400">Liability (return − stake)</div>
              <Chips amount={Number(l.liability)} />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Data providers" subtitle="Last successful and failed refresh. Errors never include credentials." />
          <CardBody>
            {health.length === 0 ? (
              <p className="text-sm text-ink-400">{cfg.mode === 'demo' ? 'Demo mode uses no external provider.' : 'No refresh has run yet.'}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Provider</Th>
                    <Th>Last success</Th>
                    <Th>Last error</Th>
                    <Th className="text-right">Quota left</Th>
                  </tr>
                </thead>
                <tbody>
                  {health.map((h) => (
                    <Tr key={h.provider}>
                      <Td>{h.provider}</Td>
                      <Td className="text-ink-400">{h.lastSuccessAt?.toLocaleString() ?? '—'}</Td>
                      <Td className="text-ink-400">{h.lastErrorAt ? `${h.lastErrorAt.toLocaleString()} — ${h.lastError ?? ''}` : '—'}</Td>
                      <Td className="num text-right">{h.requestsRemaining ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Events (last 2 days and upcoming)" />
        <CardBody>
          {events.length === 0 ? (
            <EmptyState title="No events">The sync job creates events every minute.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Kick-off</Th>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th>Result</Th>
                  {canManage && <Th>Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {events.map(({ e, home: h, away: a }) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap text-ink-400">{e.kickoffAt.toLocaleString()}</Td>
                    <Td>
                      <Link href={`/sports/events/${e.id}`} className="hover:text-gold-300">
                        {h} v {a}
                      </Link>
                      {e.isDemo && <span className="ml-1 text-xs text-ink-400">(demo)</span>}
                    </Td>
                    <Td>
                      <StatusBadge status={e.status} />
                    </Td>
                    <Td className="num">{e.homeScore === null ? (e.status === 'CANCELLED' ? 'void' : '—') : `${e.homeScore} – ${e.awayScore} (v${e.resultVersion})`}</Td>
                    {canManage && (
                      <Td>
                        <SportsEventActions eventId={e.id} hasResult={e.resultVersion > 0} started={e.kickoffAt <= now} voided={e.status === 'CANCELLED'} />
                      </Td>
                    )}
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
