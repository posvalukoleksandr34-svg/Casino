import Link from 'next/link';
import { BreakControls, LimitsForm, UsageSummary, type ResponsibleData } from '@/components/account/responsible-forms';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { getLimits, playTotals } from '@/server/responsible/limits';

export const metadata = { title: 'Responsible play' };

export default async function ResponsiblePlayPage() {
  const session = await currentSession();
  let data: ResponsibleData | null = null;
  if (session) {
    const db = getDb();
    const [limits, usage] = await Promise.all([getLimits(db, session.userId), playTotals(db, session.userId, new Date())]);
    data = {
      limits: limits.limits,
      pending: limits.pending,
      pendingEffectiveAt: limits.pendingEffectiveAt?.toISOString() ?? null,
      coolOffUntil: limits.coolOffUntil?.toISOString() ?? null,
      selfExcludedUntil: limits.selfExcludedUntil?.toISOString() ?? null,
      usage,
    };
  }
  return (
    <>
      <PageHeader
        eyebrow="Responsible play"
        title="Stay in control"
        subtitle="Aurovane uses virtual chips with no monetary value, but gambling-style games can still be habit-forming. These tools are enforced by the server before any wager is accepted."
      />
      <div className="space-y-6">
        {data ? (
          <>
            <UsageSummary data={data} />
            <LimitsForm data={data} />
            <BreakControls data={data} />
          </>
        ) : (
          <Card>
            <CardBody className="text-sm text-ink-300">
              <Link href="/login?next=/responsible-play" className="text-gold-400">
                Sign in
              </Link>{' '}
              to set limits, schedule reality checks, take a break or self-exclude.
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="Good habits" />
          <CardBody>
            <ul className="grid gap-3 text-sm text-ink-300 md:grid-cols-2">
              <li>Every game has a house edge: the longer you play, the more likely you are to finish behind.</li>
              <li>Past results do not influence future ones. There are no hot or cold streaks — each outcome is independent.</li>
              <li>Decide in advance how long you will play and stop when that time is up, win or lose.</li>
              <li>Never chase losses. If play stops being fun, take a break.</li>
              <li>Real-money gambling carries real financial risk. If gambling is causing you or someone close to you harm, contact a local problem-gambling support service or your doctor.</li>
              <li>Aurovane will never offer chips for purchase, convert them to money, or send you messages encouraging you to play.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
