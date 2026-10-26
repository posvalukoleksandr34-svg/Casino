import Link from 'next/link';
import { Suspense } from 'react';
import { SeedManager, Verifier } from '@/components/account/fairness-panel';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { fairnessOverview } from '@/server/fairness/seeds';

export const metadata = { title: 'Provably fair' };

export default async function FairnessPage() {
  const session = await currentSession();
  const overview = session ? await fairnessOverview(getDb(), session.userId) : null;
  return (
    <>
      <PageHeader
        eyebrow="Fairness"
        title="Provably fair"
        subtitle="Before you play, the server commits to a secret seed by showing you its SHA-256 hash. Each round's outcome is derived from that seed, your client seed and a counter (nonce). When you rotate seeds the old one is revealed, so you can recompute every round and confirm nothing was changed."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="The protocol" />
          <CardBody className="grid gap-6 text-sm leading-relaxed text-ink-300 md:grid-cols-3">
            <div>
              <div className="font-semibold text-ink-100">1 · Commit</div>
              <p className="mt-1">The server generates a 256-bit random seed with a cryptographically secure generator and shows you <code className="text-gold-300">SHA-256(serverSeed)</code>.</p>
            </div>
            <div>
              <div className="font-semibold text-ink-100">2 · Play</div>
              <p className="mt-1">
                Random bytes come from <code className="text-gold-300">HMAC-SHA256(serverSeed, &quot;clientSeed:nonce:i&quot;)</code>. Numbers are drawn from 4-byte words with rejection sampling, so every outcome is exactly equally likely.
              </p>
            </div>
            <div>
              <div className="font-semibold text-ink-100">3 · Reveal & verify</div>
              <p className="mt-1">Rotating reveals the old seed. Check its hash against the commitment, then recompute any round below.</p>
            </div>
          </CardBody>
        </Card>
        {overview ? (
          <SeedManager initial={overview} />
        ) : (
          <Card>
            <CardBody className="text-sm text-ink-300">
              <Link href="/login?next=/fairness" className="text-gold-400">
                Sign in
              </Link>{' '}
              to see and rotate your seeds. The verifier below works without an account.
            </CardBody>
          </Card>
        )}
        <Suspense>
          <Verifier />
        </Suspense>
        <Card>
          <CardHeader title="What this does and does not prove" />
          <CardBody className="grid gap-4 text-sm leading-relaxed text-ink-300 md:grid-cols-2">
            <p>
              It proves that each outcome was fixed by a seed chosen before you bet and was not altered afterwards, and that the
              outcome follows the published mapping from random bytes to results. Your client seed means the server could not have
              pre-selected a favourable seed for a specific outcome sequence.
            </p>
            <p>
              It does not, by itself, prove that the published payout table is what the game pays, that the platform&apos;s accounting
              is correct, or that the server&apos;s random generator is unbiased beyond what the seed commitment covers. Those are covered
              by the published rules, automated tests, ledger reconciliation and, for any licensed deployment, independent audits.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
