import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { GAME_STATUS_LABELS } from '@/components/account/labels';
import { GameGlyph } from '@/components/games/game-glyph';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Chips, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { adminGames } from '@/server/admin/admin-service';
import { requirePermission } from '@/server/auth/current';
import { canonicalJson } from '@/server/crypto';
import { getDb } from '@/server/db/client';

export const metadata = { title: 'Games' };

const TONE = { ACTIVE: 'positive', SUSPENDED: 'warning', DISABLED: 'neutral' } as const;

export default async function AdminGamesPage() {
  await requirePermission('admin:access');
  const [games, open] = await Promise.all([
    adminGames(),
    getDb().execute<{ game_id: string; n: number; started_24h: number }>(sql`
      SELECT g.id AS game_id,
             (SELECT count(*) FROM game_rounds r WHERE r.game_id = g.id AND r.status = 'OPEN')::int AS n,
             (SELECT count(*) FROM game_rounds r WHERE r.game_id = g.id AND r.started_at > now() - interval '1 day')::int AS started_24h
        FROM games g`),
  ]);
  const byGame = new Map(open.rows.map((r) => [r.game_id, r]));
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Games"
        subtitle="Every game in the catalogue: availability, stake limits, the published configuration its rules come from, and activity. Open a game to change its status or limits; every change is audited."
      />
      <Card>
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Game</Th>
                <Th>Status</Th>
                <Th className="text-right">RTP</Th>
                <Th className="text-right">Stake range</Th>
                <Th className="text-right">Open rounds</Th>
                <Th className="text-right">Rounds (24 h)</Th>
                <Th>Configuration</Th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const stats = byGame.get(g.id);
                const matches = g.activeConfig ? canonicalJson(g.activeConfig.config) === canonicalJson(g.defaultConfig) : false;
                return (
                  <Tr key={g.id}>
                    <Td>
                      <Link href={`/admin/games/${g.id}`} className="flex items-center gap-3 font-medium text-ink-100 hover:text-gold-300">
                        <GameGlyph id={g.id} className="size-7" />
                        {g.name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={TONE[g.status]}>{GAME_STATUS_LABELS[g.status]}</Badge>
                    </Td>
                    <Td className="num text-right">
                      {g.theoretical ? `${g.theoretical.method === 'exact' ? '' : '≈ '}${(g.theoretical.rtp * 100).toFixed(2)}%` : '—'}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <Chips amount={g.limits.minStake} suffix={false} /> – <Chips amount={g.limits.maxStake} suffix={false} />
                    </Td>
                    <Td className="num text-right">{stats?.n ?? 0}</Td>
                    <Td className="num text-right">{(stats?.started_24h ?? 0).toLocaleString()}</Td>
                    <Td className="text-xs">
                      v{g.activeConfig?.version ?? '—'} {matches ? <span className="text-ink-400">· published</span> : <span className="text-warning">· differs from published rules</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
