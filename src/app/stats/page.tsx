import { GAME_NAMES } from '@/components/account/labels';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, EmptyState, PageHeader, Pct, Stat } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requireUser } from '@/server/auth/current';
import { listGames } from '@/server/games/lobby';
import { playerStats } from '@/server/users/stats';
import { rtpText } from '@/lib/format';

export const metadata = { title: 'Statistics' };

export default async function StatsPage() {
  const session = await requireUser('/stats');
  const [stats, games] = await Promise.all([playerStats(session.userId), listGames({ includeDisabled: true })]);
  const theory = new Map(games.map((g) => [g.id, g.theoretical]));
  const t = stats.totals;
  return (
    <>
      <PageHeader
        eyebrow="Statistics"
        title="Your results"
        subtitle="Realised results from your settled rounds compared with each game's theoretical return. Small samples swing widely around the theoretical value — that is normal variance, not a sign that a game is hot or cold."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Rounds played" value={t.rounds.toLocaleString()} />
        <Stat label="Total wagered" value={<Chips amount={t.wagered} />} />
        <Stat label="Net result" value={<Chips amount={t.net} sign colored />} />
        <Stat label="Your realised RTP" value={<Pct value={t.wagered ? t.paidOut / t.wagered : null} />} sub="Payouts ÷ stakes" />
      </div>
      <Card className="mt-6">
        <CardHeader title="By game" />
        <CardBody>
          {stats.games.length === 0 ? (
            <EmptyState title="No settled rounds yet">Play a few rounds and your statistics will appear here.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Game</Th>
                  <Th className="text-right">Rounds</Th>
                  <Th className="text-right">Wagered</Th>
                  <Th className="text-right">Paid out</Th>
                  <Th className="text-right">Net</Th>
                  <Th className="text-right">Win rate</Th>
                  <Th className="text-right">Your RTP</Th>
                  <Th className="text-right">Theoretical RTP</Th>
                  <Th className="text-right">Best multiplier</Th>
                </tr>
              </thead>
              <tbody>
                {stats.games.map((g) => (
                  <Tr key={g.gameId}>
                    <Td className="font-medium text-ink-100">{GAME_NAMES[g.gameId] ?? g.gameId}</Td>
                    <Td className="num text-right">{g.rounds}</Td>
                    <Td className="text-right"><Chips amount={g.wagered} suffix={false} /></Td>
                    <Td className="text-right"><Chips amount={g.paidOut} suffix={false} /></Td>
                    <Td className="text-right"><Chips amount={g.net} sign colored suffix={false} /></Td>
                    <Td className="text-right"><Pct value={g.wins / g.rounds} digits={1} /></Td>
                    <Td className="text-right"><Pct value={g.wagered ? g.paidOut / g.wagered : null} /></Td>
                    <Td className="num text-right text-ink-400">{theory.has(g.gameId) ? rtpText(theory.get(g.gameId)!) : '—'}</Td>
                    <Td className="num text-right">{g.bestMultiplier.toFixed(2)}×</Td>
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
