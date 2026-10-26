import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { GAME_NAMES } from '@/components/account/labels';
import { ReasonedAction } from '@/components/admin/reasoned-action';
import { RoundStateView } from '@/components/games/round-state-view';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, Chips, Mono, PageHeader, Stat } from '@/components/ui/misc';
import { hasPermission } from '@/server/auth/rbac';
import { requirePermission } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { getRoundForUser } from '@/server/games/round-service';

export const metadata = { title: 'Round' };

export default async function AdminRoundPage({ params }: { params: Promise<{ roundId: string }> }) {
  const session = await requirePermission('rounds:read');
  const { roundId } = await params;
  if (!z.uuid().safeParse(roundId).success) notFound();
  const r = await getRoundForUser(null, roundId).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/rounds" className="hover:text-gold-300">← Rounds</Link>}
        title={`${GAME_NAMES[r.gameId] ?? r.gameId} round`}
        subtitle={r.id}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={r.status} />
            {r.status === 'OPEN' && hasPermission(session.role, 'rounds:void') && (
              <ReasonedAction
                label="Void & refund"
                title="Void open round"
                description="The round is closed without an outcome and the full stake is returned to the player via a ROUND_VOIDED ledger transaction."
                variant="danger"
                path={`/api/admin/rounds/${r.id}/void`}
                body={(reason) => ({ reason })}
              />
            )}
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Stake" value={<Chips amount={r.stake} />} />
        <Stat label="Payout" value={r.payout === null ? '—' : <Chips amount={r.payout} />} />
        <Stat label="Max payout (approved)" value={<Chips amount={r.maxPayout} />} />
        <Stat label="Player" value={<Link href={`/admin/users/${r.userId}`} className="text-base text-gold-300">View user →</Link>} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Outcome" subtitle={r.status === 'OPEN' ? 'Hidden information stays hidden from staff until the round finishes.' : undefined} />
          <CardBody>
            <RoundStateView gameId={r.gameId} state={r.state} status={r.status} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Fairness inputs" />
          <CardBody className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-ink-500">Commitment</div>
              <Mono>{r.fairness.serverSeedHash}</Mono>
            </div>
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-ink-500">Client seed</div>
                <Mono>{r.fairness.clientSeed}</Mono>
              </div>
              <div>
                <div className="text-xs text-ink-500">Nonce</div>
                <Mono>{r.fairness.nonce}</Mono>
              </div>
            </div>
            <div>
              <div className="text-xs text-ink-500">Server seed</div>
              {r.fairness.serverSeed ? <Mono>{r.fairness.serverSeed}</Mono> : <span className="text-ink-400">not yet revealed (still the player&apos;s active seed)</span>}
            </div>
            <div className="text-xs text-ink-500">
              Started {new Date(r.startedAt).toLocaleString()}
              {r.settledAt && ` · closed ${new Date(r.settledAt).toLocaleString()}`} · {r.actionCount} action(s)
            </div>
            {r.voidReason && <Callout tone="warning" title="Void reason">{r.voidReason}</Callout>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
