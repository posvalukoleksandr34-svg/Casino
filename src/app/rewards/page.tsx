import Link from 'next/link';
import { AccountTabs } from '@/components/account/account-tabs';
import { RewardList } from '@/components/rewards/reward-list';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requireUser } from '@/server/auth/current';
import { listRewards } from '@/server/rewards/rewards';

export const metadata = { title: 'Rewards' };

export default async function RewardsPage() {
  const session = await requireUser('/rewards');
  const { rewards, blocker } = await listRewards(session.userId);
  return (
    <>
      <PageHeader
        eyebrow="Loyalty"
        title="Rewards"
        subtitle={
          <>
            Rewards are virtual credits with no wagering: claim one and it goes straight to your balance. Unclaimed rewards expire on the date shown. How they are earned is on the{' '}
            <Link href="/vip" className="text-gold-300">
              VIP page
            </Link>
            .
          </>
        }
      />
      <AccountTabs />
      <Card>
        <CardBody>
          <RewardList rewards={rewards} blocker={blocker} />
        </CardBody>
      </Card>
    </>
  );
}
