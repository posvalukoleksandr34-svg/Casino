import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { DemoVerify } from '@/components/sports/demo-verify';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, Mono, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { OUTCOME_LABELS, outcomeWeights, selectionRtp, totalWeight, type Outcome } from '@/engine/sports/model';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { sportsTickets } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { getEvent } from '@/server/sports/queries';

export const metadata = { title: 'Event' };

export default async function SportsEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const event = await getEvent(eventId).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const session = await currentSession();
  const mine = session
    ? await getDb().select().from(sportsTickets).where(and(eq(sportsTickets.eventId, event.id), eq(sportsTickets.userId, session.userId))).orderBy(desc(sportsTickets.placedAt))
    : [];
  const model = event.fairness?.model ?? null;
  const total = model ? totalWeight(model) : 0;
  const weights = model ? outcomeWeights(model) : null;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/sports" className="hover:text-gold-300">← Sports</Link>}
        title={`${event.home.name} v ${event.away.name}`}
        subtitle={`${event.competition.name} · kick-off ${new Date(event.kickoffAt).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-2">
            {event.isDemo && <Badge tone="info">Demo fixture</Badge>}
            <StatusBadge status={event.status} />
          </div>
        }
      />
      {event.isDemo && (
        <Callout tone="info" className="mb-6">
          Fictional teams. The result is simulated from the published model below, drawn with a seed committed before betting opened.
        </Callout>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="1X2 market"
            subtitle={event.market ? `${event.market.oddsSource} · prices confirmed ${new Date(event.market.oddsUpdatedAt).toLocaleString()}` : 'No prices available'}
          />
          <CardBody className="space-y-4">
            {event.score && (
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-[0.14em] text-ink-400">Full-time (regular time)</div>
                <div className="num mt-1 text-4xl font-light text-ink-100" data-testid="event-score">
                  {event.score.home} – {event.score.away}
                </div>
              </div>
            )}
            {event.status === 'CANCELLED' && <Callout tone="warning">This event was voided. Every prediction on it was refunded in full.</Callout>}
            {event.market && (
              <Table>
                <thead>
                  <tr>
                    <Th>Selection</Th>
                    <Th className="text-right">Odds</Th>
                    {weights && <Th className="text-right">Model chance</Th>}
                    {weights && <Th className="text-right">RTP</Th>}
                  </tr>
                </thead>
                <tbody>
                  {event.market.selections.map((s) => (
                    <Tr key={s.id}>
                      <Td>{OUTCOME_LABELS[s.code as Outcome]}</Td>
                      <Td className="num text-right font-semibold text-gold-300">{s.oddsE2 ? (s.oddsE2 / 100).toFixed(2) : '—'}</Td>
                      {weights && <Td className="num text-right">{((weights[s.code as Outcome] / total) * 100).toFixed(2)}%</Td>}
                      {weights && <Td className="num text-right">{s.oddsE2 ? `${(selectionRtp(model!, s.code as Outcome, s.oddsE2) * 100).toFixed(2)}%` : '—'}</Td>}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {event.open ? (
              <Link href={`/sports#event-${event.id}`} className="inline-flex h-10 items-center rounded-xl bg-gradient-to-b from-gold-400 to-gold-600 px-4 text-sm font-semibold text-ink-950">
                Add a prediction on the board
              </Link>
            ) : (
              <p className="text-sm text-ink-400">{event.market?.stale ? 'Predictions are paused: prices are out of date.' : 'This market is not taking predictions.'}</p>
            )}
          </CardBody>
        </Card>

        {event.fairness && (
          <Card>
            <CardHeader title="Provably fair result" subtitle="The seed's SHA-256 was published before betting opened; the seed is revealed with the result." />
            <CardBody className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-ink-400">Seed commitment (SHA-256)</div>
                <Mono>{event.fairness.seedHash}</Mono>
              </div>
              {model && (
                <div className="text-xs text-ink-400">
                  Model: expected goals {(model.lambdaHomeE3 / 1000).toFixed(3)} (home) and {(model.lambdaAwayE3 / 1000).toFixed(3)} (away), independent Poisson, scorelines
                  0–9 as integer weights (total {total.toLocaleString('en-US')}); margin {(model.marginBp / 100).toFixed(2)}%.
                </div>
              )}
              {event.fairness.revealedSeed ? (
                <>
                  <div>
                    <div className="text-xs text-ink-400">Revealed seed</div>
                    <Mono>{event.fairness.revealedSeed}</Mono>
                  </div>
                  <DemoVerify eventId={event.id} seedHash={event.fairness.seedHash} seed={event.fairness.revealedSeed} model={model!} score={event.score} />
                </>
              ) : (
                <p className="text-ink-400">The seed stays secret until the result is drawn. <Link href="/sports/how-it-works" className="text-gold-400">How the draw works</Link></p>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      {event.results.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Result history" subtitle="Every result, correction and void is kept. Corrections only ever add to what a prediction was paid." />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Version</Th>
                  <Th>Kind</Th>
                  <Th>Result</Th>
                  <Th>Source</Th>
                  <Th>Reason</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {event.results.map((r) => (
                  <Tr key={r.version}>
                    <Td className="num">{r.version}</Td>
                    <Td>{r.kind.toLowerCase()}</Td>
                    <Td className="num">{r.home === null ? 'void' : `${r.home} – ${r.away}`}</Td>
                    <Td>{r.source}</Td>
                    <Td className="text-ink-300">{r.reason}</Td>
                    <Td className="whitespace-nowrap text-ink-400">{new Date(r.at).toLocaleString()}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {mine.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Your predictions on this event" />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Pick</Th>
                  <Th className="text-right">Odds</Th>
                  <Th className="text-right">Stake</Th>
                  <Th className="text-right">Returned</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {mine.map((t) => (
                  <Tr key={t.id}>
                    <Td>{OUTCOME_LABELS[t.selectionCode]}</Td>
                    <Td className="num text-right">{(t.oddsE2 / 100).toFixed(2)}</Td>
                    <Td className="text-right">
                      <Chips amount={t.stake} suffix={false} />
                    </Td>
                    <Td className="text-right">{t.payout === null ? '—' : <Chips amount={t.payout} suffix={false} />}</Td>
                    <Td>
                      <StatusBadge status={t.status} /> {t.rejectReason && <span className="text-xs text-ink-400">{t.rejectReason}</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
