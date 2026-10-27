import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GAME_STATUS_LABELS } from '@/components/account/labels';
import { GameStatusControl, LimitsEditor, RestoreReferenceConfig } from '@/components/admin/game-controls';
import { PeriodFilter } from '@/components/admin/period-filter';
import { GameGlyph } from '@/components/games/game-glyph';
import { summarizeRound } from '@/components/games/summaries';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, EmptyState, PageHeader, Pct, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { gameDetail } from '@/server/admin/games';
import { resolvePeriod } from '@/server/admin/period';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { AppError } from '@/server/errors';

export const metadata = { title: 'Game' };

const TONE = { ACTIVE: 'positive', SUSPENDED: 'warning', DISABLED: 'neutral' } as const;

function utc(d: Date | string | null | undefined) {
  return d ? `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';
}

export default async function AdminGamePage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const session = await requirePermission('admin:access');
  const { gameId } = await params;
  const sp = await searchParams;
  let period;
  try {
    period = resolvePeriod(sp);
  } catch {
    period = resolvePeriod({ period: '7d' });
  }
  const d = await gameDetail(gameId, period).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const canGames = hasPermission(session.role, 'games:manage');
  const canRisk = hasPermission(session.role, 'risk:manage');
  const canRounds = hasPermission(session.role, 'rounds:read');
  const m = d.period.metrics;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/games" className="hover:text-gold-300">
            ← Games
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <GameGlyph id={d.game.id} className="size-10" />
            {d.game.name}
          </span>
        }
        subtitle={d.entry.tagline}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[d.game.status]}>{GAME_STATUS_LABELS[d.game.status]}</Badge>
            {canGames && <GameStatusControl gameId={d.game.id} status={d.game.status} openRounds={d.open.count} />}
            {canRisk && (
              <LimitsEditor
                gameId={d.game.id}
                limits={{ minStake: d.limits.minStake, maxStake: d.limits.maxStake, maxPayoutPerRound: d.limits.maxPayoutPerRound, maxGameExposure: d.limits.maxGameExposure }}
                hard={d.hardLimits}
              />
            )}
            {canGames && !d.matchesReference && <RestoreReferenceConfig gameId={d.game.id} reference={d.referenceConfig} />}
          </div>
        }
      />
      {d.game.status !== 'ACTIVE' && d.game.statusReason && (
        <Callout tone="warning" className="mb-6" title={GAME_STATUS_LABELS[d.game.status]}>
          {d.game.statusReason}
        </Callout>
      )}
      {!d.matchesReference && (
        <Callout tone="negative" className="mb-6" title="The active configuration differs from the published rules">
          Players are shown rules and payout tables generated from the published configuration. Restore it, or change the published rules in code.
        </Callout>
      )}
      {d.open.overdue > 0 && (
        <Callout tone="negative" className="mb-6" title={`${d.open.overdue} round${d.open.overdue === 1 ? '' : 's'} overdue for settlement`}>
          Time-decided rounds more than 5 minutes past their deadline. The expiry job retries with backoff; check System health and the error log.
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Published return"
          value={d.theoretical ? `${d.theoretical.method === 'exact' ? '' : '≈ '}${(d.theoretical.rtp * 100).toFixed(3)}%` : '—'}
          sub={d.theoretical ? `${d.theoretical.method === 'exact' ? 'Exact' : 'Simulation estimate'} · house edge ${(d.theoretical.houseEdge * 100).toFixed(3)}%` : undefined}
          tone="gold"
        />
        <Stat label="Stake range" value={<><Chips amount={d.limits.minStake} suffix={false} /> – <Chips amount={d.limits.maxStake} /></>} sub={<>Max payout <Chips amount={d.limits.maxPayoutPerRound} compact suffix={false} /> · exposure cap <Chips amount={d.limits.maxGameExposure} compact suffix={false} /></>} />
        <Stat label="Open rounds" value={d.open.count.toLocaleString()} sub={d.open.oldest ? `Oldest started ${utc(d.open.oldest)}` : 'None'} />
        <Stat label="Configuration" value={`v${d.activeConfig?.version ?? '—'}`} sub={d.matchesReference ? 'Matches the published rules' : 'Differs from published rules'} />
      </div>

      <h2 className="mb-3 mt-8 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">Activity</h2>
      <PeriodFilter basePath={`/admin/games/${d.game.id}`} params={sp} period={period} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Rounds started" value={d.period.startedRounds.toLocaleString()} sub={`${d.period.players.toLocaleString()} players`} />
        <Stat label="Rounds settled" value={(m?.rounds ?? 0).toLocaleString()} sub={<>Wagered <Chips amount={m?.stake ?? 0} compact suffix={false} /> · paid <Chips amount={m?.payout ?? 0} compact suffix={false} /></>} />
        <Stat label="Realised RTP" value={<Pct value={m?.actualRtp ?? null} />} sub={m?.rtpCi95 ? <>Expected band <Pct value={m.rtpCi95[0]} />–<Pct value={m.rtpCi95[1]} /></> : 'No settled rounds'} />
        <Stat
          label="Actual vs expected"
          value={m?.zScore === null || m?.zScore === undefined ? '—' : `${m.zScore >= 0 ? '+' : ''}${m.zScore.toFixed(2)}σ`}
          sub="Payouts against the rules' expectation for these bets"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent rounds" actions={canRounds ? <Link href={`/admin/rounds?game=${d.game.id}`} className="text-xs text-gold-400">All →</Link> : undefined} />
          <CardBody>
            {d.recentRounds.length === 0 ? (
              <EmptyState title="No rounds yet" />
            ) : (
              <Table>
                <tbody>
                  {d.recentRounds.map((r) => (
                    <Tr key={r.id}>
                      <Td className="whitespace-nowrap text-xs text-ink-400">{canRounds ? <Link href={`/admin/rounds/${r.id}`} className="hover:text-gold-300">{utc(r.startedAt)}</Link> : utc(r.startedAt)}</Td>
                      <Td className="text-xs">{summarizeRound(r.gameId, r.summary, r.status)}</Td>
                      <Td className="text-right">
                        <Chips amount={r.stake} suffix={false} />
                      </Td>
                      <Td className="text-right">{r.payout === null ? <StatusBadge status={r.status} /> : <Chips amount={r.payout} suffix={false} />}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Overdue settlements" subtitle="Open time-decided rounds more than 5 minutes past their deadline" />
          <CardBody>
            {d.overdueRounds.length === 0 ? (
              <p className="text-sm text-ink-400">None. Rounds are settling on time.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Round</Th>
                    <Th>Deadline</Th>
                    <Th className="text-right">Attempts</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.overdueRounds.map((r) => (
                    <Tr key={r.id}>
                      <Td className="text-xs">{canRounds ? <Link href={`/admin/rounds/${r.id}`} className="text-gold-300">{r.id.slice(0, 8)}</Link> : r.id.slice(0, 8)}</Td>
                      <Td className="text-xs text-ink-300">{utc(r.expires_at)}</Td>
                      <Td className="num text-right">{r.expiry_attempts}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Configuration versions" subtitle="Immutable; every round references the version it was played under" />
          <CardBody>
            <ul className="divide-y divide-ink-800 text-sm">
              {d.versions.map((v) => (
                <li key={v.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-ink-100">
                      v{v.version} {v.isActive && <Badge tone="gold">active</Badge>}
                    </span>
                    <span className="text-xs text-ink-400">
                      {utc(v.createdAt)}
                      {v.createdBy ? ` · ${v.createdBy}` : ' · bootstrap'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {d.activeConfig && <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-ink-900 p-3 text-[11px] text-ink-300">{JSON.stringify(d.activeConfig.config, null, 2)}</pre>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change history" subtitle="Status, limit and configuration changes with their reasons" />
          <CardBody>
            {d.history.length === 0 ? (
              <p className="text-sm text-ink-400">No changes since the game was installed.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-ink-800 overflow-y-auto text-sm">
                {d.history.map((h) => (
                  <li key={h.id} className="py-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-ink-100">{h.action}</span>
                      <span className="whitespace-nowrap text-xs text-ink-400">{utc(h.createdAt)}</span>
                    </div>
                    <div className="text-xs text-ink-400">
                      {h.actorName ?? 'system'}
                      {h.actorRole ? ` (${h.actorRole.toLowerCase().replace('_', ' ')})` : ''} — {h.reason}
                    </div>
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
