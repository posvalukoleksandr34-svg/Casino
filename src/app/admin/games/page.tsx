import { ConfigEditor, GameStatusControl, LimitsEditor } from '@/components/admin/game-controls';
import { GameGlyph } from '@/components/games/game-glyph';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader } from '@/components/ui/misc';
import { adminGames } from '@/server/admin/admin-service';
import { hasPermission } from '@/server/auth/rbac';
import { requirePermission } from '@/server/auth/current';

export const metadata = { title: 'Games & configuration' };

export default async function AdminGamesPage() {
  const session = await requirePermission('admin:access');
  const games = await adminGames();
  const canGames = hasPermission(session.role, 'games:manage');
  const canRisk = hasPermission(session.role, 'risk:manage');
  return (
    <>
      <PageHeader eyebrow="Admin" title="Games & configuration" subtitle="Game status, versioned rule configuration and per-game risk limits. Every change requires a reason and is audited." />
      <div className="space-y-6">
        {games.map((g) => (
          <Card key={g.id}>
            <CardHeader
              title={
                <span className="flex items-center gap-3">
                  <GameGlyph id={g.id} className="size-8" />
                  <span className="font-display text-xl">{g.name}</span>
                  <StatusBadge status={g.status} />
                </span>
              }
              subtitle={g.statusReason ?? undefined}
              actions={
                <>
                  {canGames && <GameStatusControl gameId={g.id} status={g.status} />}
                  {canGames && g.activeConfig && <ConfigEditor gameId={g.id} config={g.activeConfig.config} />}
                  {canRisk && <LimitsEditor gameId={g.id} limits={{ minStake: g.limits.minStake, maxStake: g.limits.maxStake, maxPayoutPerRound: g.limits.maxPayoutPerRound, maxGameExposure: g.limits.maxGameExposure }} />}
                </>
              }
            />
            <CardBody className="grid gap-6 md:grid-cols-3">
              <div className="text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Theoretical return</div>
                {g.theoretical && (
                  <>
                    <div className="num mt-1 text-2xl text-gold-300">{(g.theoretical.rtp * 100).toFixed(3)}%</div>
                    <div className="text-xs text-ink-400">
                      edge {(g.theoretical.houseEdge * 100).toFixed(3)}% · {g.theoretical.method}
                    </div>
                  </>
                )}
              </div>
              <div className="text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Limits</div>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-ink-500">Stake</dt>
                  <dd>
                    <Chips amount={g.limits.minStake} suffix={false} /> – <Chips amount={g.limits.maxStake} suffix={false} />
                  </dd>
                  <dt className="text-ink-500">Max payout</dt>
                  <dd><Chips amount={g.limits.maxPayoutPerRound} suffix={false} /></dd>
                  <dt className="text-ink-500">Max exposure</dt>
                  <dd><Chips amount={g.limits.maxGameExposure} suffix={false} /></dd>
                </dl>
              </div>
              <div className="text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Active configuration v{g.activeConfig?.version}</div>
                <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-ink-900 p-2 text-[11px] text-ink-300">{JSON.stringify(g.activeConfig?.config, null, 2)}</pre>
                <div className="mt-1 text-xs text-ink-500">{g.versions.length} version(s) on record</div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
