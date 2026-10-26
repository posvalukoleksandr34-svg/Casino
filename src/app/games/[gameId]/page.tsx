import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DiceGame } from '@/components/games/dice-game';
import { RouletteGame } from '@/components/games/roulette-game';
import { GameRules } from '@/components/games/game-rules';
import { Badge } from '@/components/ui/badge';
import { Callout, Chips, PageHeader } from '@/components/ui/misc';
import type { DiceConfig } from '@/engine/games/dice';
import type { RouletteConfig } from '@/engine/games/roulette';
import { getGameSummary } from '@/server/games/lobby';
import { currentSession } from '@/server/auth/current';

export async function generateMetadata({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const game = await getGameSummary(gameId);
  return { title: game?.name ?? 'Game' };
}

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const [game, session] = await Promise.all([getGameSummary(gameId), currentSession()]);
  if (!game || game.status === 'DISABLED') notFound();

  const props = { limits: game.limits, status: game.status };
  let screen: React.ReactNode;
  switch (game.id) {
    case 'roulette':
      screen = <RouletteGame {...props} config={game.config as RouletteConfig} />;
      break;
    case 'dice':
      screen = <DiceGame {...props} config={game.config as DiceConfig} />;
      break;
    default:
      notFound();
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/lobby" className="hover:text-gold-300">← Lobby</Link>}
        title={game.name}
        subtitle={game.tagline}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="gold">RTP {(game.theoretical.rtp * 100).toFixed(2)}%</Badge>
            <Badge>House edge {(game.theoretical.houseEdge * 100).toFixed(2)}%</Badge>
            <Badge>
              Limits <Chips amount={game.limits.minStake} suffix={false} />–<Chips amount={game.limits.maxStake} suffix={false} />
            </Badge>
          </div>
        }
      />
      {game.status !== 'ACTIVE' && (
        <Callout tone="warning" title="This game is paused" className="mb-6">
          {game.statusReason ?? 'New rounds are not being accepted right now.'} Open rounds can still be completed.
        </Callout>
      )}
      {!session && (
        <Callout tone="gold" className="mb-6" title="Sign in to play">
          <Link href={`/login?next=/games/${game.id}`} className="text-gold-300 underline">
            Sign in
          </Link>{' '}
          or{' '}
          <Link href="/register" className="text-gold-300 underline">
            create an account
          </Link>{' '}
          to receive 10,000 virtual chips. You can explore the table and payouts without an account.
        </Callout>
      )}
      {screen}
      <div className="mt-10">
        <GameRules gameId={game.id} theoretical={game.theoretical} />
      </div>
    </>
  );
}
