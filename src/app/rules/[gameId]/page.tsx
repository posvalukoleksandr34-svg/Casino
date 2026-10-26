import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GameRules } from '@/components/games/game-rules';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader } from '@/components/ui/misc';
import { getGameSummary } from '@/server/games/lobby';

export default async function GameRulesPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const game = await getGameSummary(gameId);
  if (!game || game.status === 'DISABLED') notFound();
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/rules" className="hover:text-gold-300">← Rules & odds</Link>}
        title={`${game.name} rules`}
        subtitle={game.tagline}
        actions={<Link href={`/games/${game.id}`} className="inline-flex h-10 items-center rounded-xl bg-gradient-to-b from-gold-400 to-gold-600 px-4 text-sm font-semibold text-ink-950">Play</Link>}
      />
      <GameRules gameId={game.id} theoretical={game.theoretical} full />
      <Card className="mt-6">
        <CardHeader title="Table limits" subtitle={`Configuration version ${game.configVersion}`} />
        <CardBody className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-ink-500">Minimum stake</div>
            <Chips amount={game.limits.minStake} />
          </div>
          <div>
            <div className="text-xs text-ink-500">Maximum stake</div>
            <Chips amount={game.limits.maxStake} />
          </div>
          <div>
            <div className="text-xs text-ink-500">Maximum payout per round</div>
            <Chips amount={game.limits.maxPayoutPerRound} />
          </div>
        </CardBody>
      </Card>
    </>
  );
}
