import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PredictionWindowAction, SportsEventActions } from '@/components/admin/sports-actions';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, EmptyState, Mono, PageHeader, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { AppError } from '@/server/errors';
import { sportsEventAdminDetail } from '@/server/sports/admin';

export const metadata = { title: 'Sports event' };

const PICK: Record<string, string> = { HOME: '1 (home)', DRAW: 'X (draw)', AWAY: '2 (away)' };

function utc(d: Date | string | null | undefined) {
  return d ? `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';
}

export default async function AdminSportsEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await requirePermission('admin:access');
  const { eventId } = await params;
  const d = await sportsEventAdminDetail(eventId).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const canManage = hasPermission(session.role, 'sports:manage');
  const e = d.event;
  const now = new Date();
  const started = e.kickoffAt <= now;
  const totalStake = d.byPick.filter((r) => r.status !== 'REJECTED').reduce((a, r) => a + r.stake, 0);
  const openLiability = d.byPick.filter((r) => r.status === 'ACCEPTED' || r.status === 'SUSPENDED').reduce((a, r) => a + r.potential - r.stake, 0);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/sports" className="hover:text-gold-300">
            ← Sports
          </Link>
        }
        title={`${d.home} v ${d.away}`}
        subtitle={`${d.competition} · kick-off ${utc(e.kickoffAt)} · source ${e.source}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {e.isDemo ? <Badge tone="info">Demo (fictional)</Badge> : <Badge tone="gold">Live data</Badge>}
            <StatusBadge status={e.status} />
            {canManage && (
              <>
                <SportsEventActions eventId={e.id} hasResult={e.resultVersion > 0} started={started} voided={e.status === 'CANCELLED'} />
                {d.market && !started && e.resultVersion === 0 && (
                  <PredictionWindowAction eventId={e.id} opensAt={d.window?.opensAt?.toISOString() ?? null} closesAt={d.window?.closesAt.toISOString() ?? null} kickoffAt={e.kickoffAt.toISOString()} />
                )}
              </>
            )}
            <Link href={`/sports/events/${e.id}`} className="text-sm text-gold-400">
              Player view →
            </Link>
          </div>
        }
      />
      {d.unsettled > 0 && (
        <Callout tone="warning" className="mb-6" title={`${d.unsettled} prediction${d.unsettled === 1 ? '' : 's'} not yet settled to the latest result`}>
          The settlement job brings them up to date every minute; settlement is idempotent, so nothing is paid twice.
        </Callout>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Result" value={e.homeScore === null ? (e.status === 'CANCELLED' ? 'Void' : '—') : `${e.homeScore} – ${e.awayScore}`} sub={e.resultVersion ? `Version ${e.resultVersion} · ${e.resultSource ?? ''}` : 'No result yet'} />
        <Stat
          label="Market"
          value={d.market ? d.market.status.toLowerCase() : '—'}
          sub={d.window ? `${d.window.state === 'open' ? 'Open' : d.window.state === 'closed' ? 'Closed' : 'Not open yet'} · closes ${utc(d.window.closesAt)}${d.window.opensAt ? ` · opens ${utc(d.window.opensAt)}` : ''}` : undefined}
        />
        <Stat label="Chips staked" value={<Chips amount={totalStake} compact />} sub="Accepted and settled predictions" />
        <Stat label="Open liability" value={<Chips amount={openLiability} compact />} sub="Potential return − stake of open predictions" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Prices" subtitle={d.market ? `${d.market.oddsSource} · version ${d.market.version} · updated ${utc(d.market.oddsUpdatedAt)}` : undefined} />
          <CardBody>
            {d.selections.length === 0 ? (
              <EmptyState title="No market" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Selection</Th>
                    <Th className="text-right">Decimal odds</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.selections.map((s) => (
                    <Tr key={s.id}>
                      <Td>{PICK[s.code]}</Td>
                      <Td className="num text-right">{s.oddsE2 === null ? 'not offered' : (s.oddsE2 / 100).toFixed(2)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="mt-3 text-xs text-ink-400">
              {e.isDemo ? 'Prices come from the published demo model (6 % margin); they cannot be edited.' : 'Prices come from the configured odds provider; they cannot be edited.'}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Predictions by selection" />
          <CardBody>
            {d.byPick.length === 0 ? (
              <EmptyState title="No predictions on this event" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Pick</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Count</Th>
                    <Th className="text-right">Stake</Th>
                    <Th className="text-right">Credited</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.byPick.map((r) => (
                    <Tr key={`${r.code}-${r.status}`}>
                      <Td>{PICK[r.code] ?? r.code}</Td>
                      <Td>
                        <StatusBadge status={r.status} />
                      </Td>
                      <Td className="num text-right">{r.count}</Td>
                      <Td className="text-right">
                        <Chips amount={r.stake} suffix={false} />
                      </Td>
                      <Td className="text-right">
                        <Chips amount={r.credited} suffix={false} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Result versions" subtitle="Append-only; each settles every prediction once" />
          <CardBody>
            {d.results.length === 0 ? (
              <p className="text-sm text-ink-400">No result recorded.</p>
            ) : (
              <ul className="divide-y divide-ink-800 text-sm">
                {d.results.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-ink-100">
                        v{r.version} · {r.kind.toLowerCase()} {r.kind === 'VOID' ? '' : `${r.homeScore} – ${r.awayScore}`}
                      </span>
                      <span className="whitespace-nowrap text-xs text-ink-400">{utc(r.createdAt)}</span>
                    </div>
                    <div className="text-xs text-ink-400">
                      {r.source} — {r.reason}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {e.isDemo && e.seedHash && (
              <div className="mt-3 text-xs text-ink-400">
                Seed commitment <Mono>{e.seedHash}</Mono>
                {e.revealedSeed ? ' · revealed with the result' : ' · revealed when the result is drawn'}
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Settlement history" subtitle="Per result version" />
          <CardBody>
            {d.settlements.length === 0 ? (
              <p className="text-sm text-ink-400">Nothing settled yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th className="text-right">Won / lost / void</Th>
                    <Th className="text-right">Credited</Th>
                    <Th>Settled</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.settlements.map((s) => (
                    <Tr key={s.version}>
                      <Td>v{s.version}</Td>
                      <Td className="num text-right">
                        {s.won} / {s.lost} / {s.voided}
                      </Td>
                      <Td className="text-right">
                        <Chips amount={s.credited} suffix={false} />
                      </Td>
                      <Td className="text-xs text-ink-400">{utc(s.last_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Operator actions" subtitle="Every change to this event, with who made it and why" />
          <CardBody>
            {d.history.length === 0 ? (
              <p className="text-sm text-ink-400">No operator actions on this event.</p>
            ) : (
              <ul className="divide-y divide-ink-800 text-sm">
                {d.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap justify-between gap-3 py-2">
                    <span className="text-ink-100">
                      {h.action} <span className="text-ink-400">— {h.reason}</span>
                    </span>
                    <span className="whitespace-nowrap text-xs text-ink-400">
                      {h.adminName} · {utc(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
