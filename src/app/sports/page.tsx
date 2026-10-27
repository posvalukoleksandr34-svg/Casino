import Link from 'next/link';
import { SportsBoard } from '@/components/sports/sports-board';
import { Callout, PageHeader } from '@/components/ui/misc';
import { pageSession } from '@/server/auth/current';
import { DEMO_SCHEDULE, sportsConfig } from '@/server/sports/config';
import { listEvents, listSportsFavorites } from '@/server/sports/queries';

export const metadata = { title: 'Sports predictions' };

export default async function SportsPage() {
  const cfg = sportsConfig();
  const session = await pageSession();
  const header = (
    <PageHeader
      eyebrow="Sports"
      title="Football predictions"
      subtitle="Pre-match 1X2 predictions with virtual chips: home win (1), draw (X) or away win (2). Chips have no monetary value; this is not real-money betting."
      actions={
        session ? (
          <Link href="/sports/tickets" className="inline-flex h-10 items-center rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">
            My predictions
          </Link>
        ) : undefined
      }
    />
  );
  if (cfg.mode === 'off' || cfg.misconfigured) {
    return (
      <>
        {header}
        <Callout tone="info" title="Sports predictions are not available">
          {cfg.misconfigured
            ? 'Live data is selected but the data providers are not configured, so no events are offered. Nothing is shown rather than made-up fixtures.'
            : 'This section is switched off on this server.'}
        </Callout>
      </>
    );
  }
  const [events, favorites] = await Promise.all([listEvents(), session ? listSportsFavorites(session.userId) : Promise.resolve(null)]);
  const source = events.upcoming.find((e) => e.market)?.market?.oddsSource;
  return (
    <>
      {header}
      {cfg.mode === 'demo' ? (
        <Callout tone="info" title="Demo fixtures — not real matches" className="mb-6">
          Teams and competitions are fictional. Odds come from a published house model with a 6% margin, so each prediction returns at most 94.34% over
          the long run. Every result is drawn {DEMO_SCHEDULE.resultDelayMinutes} minutes after kick-off from a seed whose hash is published before betting
          opens — you can <Link href="/sports/how-it-works" className="text-gold-300 underline">check every result</Link>.
        </Callout>
      ) : (
        <Callout tone="info" title="Real fixtures, virtual chips" className="mb-6">
          Fixtures and results: football-data.org. Odds: {source ?? 'The Odds API'}, shown with the time they were last confirmed. Predictions pause when
          prices are out of date.
        </Callout>
      )}
      {!session && (
        <Callout tone="gold" className="mb-6" title="Sign in to make predictions">
          <Link href="/login?next=/sports" className="text-gold-300 underline">
            Sign in
          </Link>{' '}
          or{' '}
          <Link href="/register" className="text-gold-300 underline">
            create an account
          </Link>{' '}
          to place predictions with virtual chips. Fixtures and prices are visible without an account.
        </Callout>
      )}
      <SportsBoard mode={cfg.mode} initialUpcoming={events.upcoming} initialRecent={events.recent} initialFavorites={favorites} />
    </>
  );
}
