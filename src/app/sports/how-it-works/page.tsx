import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { DEMO_MARGIN_BP } from '@/engine/sports/model';
import { DEMO_SCHEDULE, POSTPONEMENT_VOID_HOURS, SPORTS_LIMITS } from '@/server/sports/config';
import { formatChips } from '@/engine/money';

export const metadata = { title: 'How sports predictions work' };

const margin = DEMO_MARGIN_BP / 100;
const maxRtp = ((10_000 / (10_000 + DEMO_MARGIN_BP)) * 100).toFixed(2);

export default function SportsHowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/sports" className="hover:text-gold-300">← Sports</Link>}
        title="How sports predictions work"
        subtitle="Rules, prices, settlement and the demo draw. Virtual chips only: they have no monetary value and cannot be bought, sold, withdrawn or exchanged."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Predictions" />
          <CardBody className="space-y-2 text-sm text-ink-300">
            <p>Each prediction is a single pick on the full-time 1X2 result of one football match: 1 (home win), X (draw) or 2 (away win). Extra time and penalties do not count.</p>
            <p>A winning prediction returns stake × odds, rounded down to 0.01 chip, stake included. A losing one returns nothing.</p>
            <p>
              Stakes: {formatChips(SPORTS_LIMITS.minStake)} to {formatChips(SPORTS_LIMITS.maxStake)} chips per pick; at most {formatChips(SPORTS_LIMITS.maxReturnPerTicket)} chips return per pick; up to{' '}
              {SPORTS_LIMITS.maxSelectionsPerSlip} picks per slip, each settled on its own.
            </p>
            <p>Predictions close at kick-off. Your play limits, cool-off and self-exclusion apply to predictions exactly as to casino games, and predictions count toward the same limits.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Prices" />
          <CardBody className="space-y-2 text-sm text-ink-300">
            <p>The price you get is the server&apos;s current price when your slip arrives. If it changed since you added the pick, the pick is not placed (and no chips are taken) unless you ticked “accept the current price”.</p>
            <p>
              Demo fixtures are priced by a published house model with a {margin}% margin on each selection: odds = 1 ÷ (model probability × {1 + DEMO_MARGIN_BP / 10_000}), rounded down.
              Over the long run each demo prediction returns at most {maxRtp}% of its stake. Prices below 1.01 are not offered.
            </p>
            <p>With live data, prices come from the bookmaker named next to them via The Odds API and are confirmed at every refresh; predictions pause when a price has not been confirmed recently.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Settlement, voids and corrections" />
          <CardBody className="space-y-2 text-sm text-ink-300">
            <p>Predictions settle automatically when the result is recorded. A cancelled or abandoned match — or one postponed for more than {POSTPONEMENT_VOID_HOURS} hours — is void: every stake is returned in full, exactly once.</p>
            <p>
              If a result is corrected after settlement, every prediction is settled again under the new result, but only ever in your favour: if the corrected result entitles you to more, the
              difference is credited; if it entitles you to less, nothing is taken back. Every version of a result is listed on the event page.
            </p>
            <p>A suspended match (for example, under review) holds predictions until it resumes, finishes or is voided.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="The demo draw" />
          <CardBody className="space-y-2 text-sm text-ink-300">
            <p>
              Demo teams and competitions are invented. Each demo match has expected goals from fictional team ratings; home and away goals are independent Poisson variables, published as
              integer weights for every score from 0–0 to 9–9 on the event page.
            </p>
            <p>
              When the fixture is created, the server picks a secret seed and publishes its SHA-256 hash. {DEMO_SCHEDULE.resultDelayMinutes} minutes after kick-off the score is drawn: an
              unbiased integer below the total weight from the HMAC-SHA256 stream of the seed (client seed “sports-demo-&lt;event id&gt;”, nonce 0) picks the scoreline. The seed is then
              revealed, and the event page recomputes the score in your browser.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
