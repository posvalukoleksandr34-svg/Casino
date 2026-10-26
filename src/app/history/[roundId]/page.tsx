import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { GAME_NAMES } from '@/components/account/labels';
import { RoundStateView } from '@/components/games/round-state-view';
import { summarizeRound } from '@/components/games/summaries';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, Mono, PageHeader, Stat } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { getRoundForUser } from '@/server/games/round-service';
import { verifyQueryForRound } from '@/components/games/verify-link';

export const metadata = { title: 'Round details' };

export default async function RoundPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const session = await requireUser(`/history/${roundId}`);
  if (!z.uuid().safeParse(roundId).success) notFound();
  const round = await getRoundForUser(session.userId, roundId).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const net = round.payout === null ? null : round.payout - round.stake;
  const verifyQuery = verifyQueryForRound(round);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/history" className="hover:text-gold-300">← Game history</Link>}
        title={GAME_NAMES[round.gameId] ?? round.gameId}
        subtitle={`${summarizeRound(round.gameId, round.state, round.status)} · ${new Date(round.startedAt).toLocaleString()}`}
        actions={<StatusBadge status={round.status} />}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Stake" value={<Chips amount={round.stake} />} />
        <Stat label="Payout" value={round.payout === null ? '—' : <Chips amount={round.payout} />} />
        <Stat label="Net" value={net === null ? '—' : <Chips amount={net} sign colored />} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Outcome" />
          <CardBody>
            <RoundStateView gameId={round.gameId} state={round.state} status={round.status} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Provably fair inputs" subtitle="Recompute this result yourself once the server seed is revealed." />
          <CardBody className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-ink-500">Server seed commitment (SHA-256)</div>
              <Mono>{round.fairness.serverSeedHash}</Mono>
            </div>
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-xs text-ink-500">Client seed</div>
                <Mono>{round.fairness.clientSeed}</Mono>
              </div>
              <div>
                <div className="text-xs text-ink-500">Nonce</div>
                <Mono>{round.fairness.nonce}</Mono>
              </div>
            </div>
            {round.fairness.serverSeed ? (
              <>
                <div>
                  <div className="text-xs text-ink-500">Revealed server seed</div>
                  <Mono>{round.fairness.serverSeed}</Mono>
                </div>
                <Link href={`/fairness?${verifyQuery}#verify`} className="inline-flex h-10 items-center rounded-xl bg-gradient-to-b from-gold-400 to-gold-600 px-4 text-sm font-semibold text-ink-950">
                  Verify this round
                </Link>
              </>
            ) : (
              <Callout tone="info">
                The server seed for this round is still active and therefore secret. <Link href="/fairness" className="text-gold-400">Rotate your seed</Link> to reveal it,
                then return here to verify.
              </Callout>
            )}
            {round.voidReason && <Callout tone="warning" title="Voided">{round.voidReason}</Callout>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
