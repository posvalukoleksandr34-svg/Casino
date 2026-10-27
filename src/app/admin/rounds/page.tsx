import Link from 'next/link';
import { GAME_NAMES } from '@/components/account/labels';
import { summarizeRound } from '@/components/games/summaries';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Chips, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { requirePermission } from '@/server/auth/current';
import { catalogEntries } from '@/server/games/catalog';
import { listRounds } from '@/server/games/round-service';

export const metadata = { title: 'Rounds' };

export default async function AdminRoundsPage({ searchParams }: { searchParams: Promise<{ game?: string; status?: string; userId?: string }> }) {
  await requirePermission('rounds:read');
  const sp = await searchParams;
  const status = ['OPEN', 'SETTLED', 'VOIDED'].includes(sp.status ?? '') ? (sp.status as 'OPEN' | 'SETTLED' | 'VOIDED') : undefined;
  const items = await listRounds({ gameId: sp.game, status, userId: sp.userId && /^[0-9a-f-]{36}$/.test(sp.userId) ? sp.userId : undefined, limit: 100 });
  const link = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/admin/rounds?${q}`;
  };
  return (
    <>
      <PageHeader eyebrow="Admin" title="Game rounds" subtitle="Settled rounds are immutable. Open rounds can be voided (full refund) during incidents." />
      <div className="mb-4 flex flex-wrap gap-2">
        {[undefined, ...catalogEntries().map((e) => e.id)].map((g) => (
          <Link key={g ?? 'all'} href={link({ game: g })} className={cn('rounded-lg border px-3 py-1.5 text-sm', sp.game === g ? 'border-gold-500 text-gold-200' : 'border-ink-700 text-ink-300')}>
            {g ? GAME_NAMES[g] : 'All games'}
          </Link>
        ))}
        <span className="mx-2 w-px bg-ink-700" />
        {[undefined, 'OPEN', 'SETTLED', 'VOIDED'].map((s) => (
          <Link key={s ?? 'any'} href={link({ status: s })} className={cn('rounded-lg border px-3 py-1.5 text-sm', sp.status === s ? 'border-gold-500 text-gold-200' : 'border-ink-700 text-ink-300')}>
            {s ? s.toLowerCase() : 'Any status'}
          </Link>
        ))}
      </div>
      <Card>
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Game</Th>
                <Th>Outcome</Th>
                <Th>Status</Th>
                <Th className="text-right">Stake</Th>
                <Th className="text-right">Payout</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">
                    <Link href={`/admin/rounds/${r.id}`} className="text-ink-300 hover:text-gold-300">
                      {new Date(r.startedAt).toLocaleString()}
                    </Link>
                  </Td>
                  <Td>{GAME_NAMES[r.gameId]}</Td>
                  <Td className="text-xs">{summarizeRound(r.gameId, r.summary, r.status)}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td className="text-right"><Chips amount={r.stake} suffix={false} /></Td>
                  <Td className="text-right">{r.payout === null ? '—' : <Chips amount={r.payout} suffix={false} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
