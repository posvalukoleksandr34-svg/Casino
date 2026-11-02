import Link from 'next/link';
import { BonusDashboard } from '@/components/promotions/bonus-dashboard';
import { PageHeader } from '@/components/ui/misc';
import { pageSession } from '@/server/auth/current';
import { DEFAULT_WELCOME_CAMPAIGN, bonusOverview } from '@/server/promotions/campaigns';
import { formatChips } from '@/engine/money';

export const metadata = { title: 'Promotions' };

export default async function PromotionsPage() {
  const session = await pageSession();
  const overview = session && !session.onboardingPending ? await bonusOverview(session.userId) : null;
  return (
    <>
      <PageHeader
        eyebrow="Promotions"
        title="Bonuses & offers"
        subtitle="Bonus credits are virtual, like every credit here: free, never sold, never withdrawable. A bonus is locked until its wagering is met, then it joins your wallet."
      />
      {overview ? (
        <BonusDashboard initial={overview} />
      ) : (
        <section className="surface relative overflow-hidden p-8">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(60%_80%_at_100%_50%,rgb(199_163_91/0.18),transparent_70%)]" aria-hidden="true" />
          <div className="relative max-w-xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">Welcome offer</div>
            <h2 className="mt-1 font-display text-4xl font-semibold text-ink-100">{DEFAULT_WELCOME_CAMPAIGN.name}</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-300">
              New accounts receive free starting credits, and can then claim 100% of them again as bonus credits — up to{' '}
              {formatChips(DEFAULT_WELCOME_CAMPAIGN.maxBonus)}. Wager the bonus amount once and it moves into your wallet.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/register" className="inline-flex h-11 items-center rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 px-6 text-sm font-semibold text-ink-950">
                Create a free account
              </Link>
              <Link href="/login?next=/promotions" className="inline-flex h-11 items-center rounded-xl border border-white/12 bg-white/[0.05] px-5 text-sm text-ink-200">
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-xs text-ink-400">18+ only. Credits have no monetary value.</p>
          </div>
        </section>
      )}
    </>
  );
}
