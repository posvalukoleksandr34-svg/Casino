import { VipTierForm } from '@/components/admin/compliance-controls';
import { RewardSettingsForm } from '@/components/admin/engagement-controls';
import { getRewardSettings } from '@/server/rewards/rewards';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { getDb } from '@/server/db/client';
import { loadTiers } from '@/server/vip/vip';
import { formatChips } from '@/engine/money';

export const metadata = { title: 'VIP tiers' };

export default async function AdminVipPage() {
  const session = await requirePermission('admin:access');
  const canEdit = hasPermission(session.role, 'promotions:manage');
  const [tiers, rewardSettings] = await Promise.all([loadTiers(getDb()), getRewardSettings(getDb())]);
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="VIP & rewards"
        subtitle="Tiers follow lifetime casino wagering and are never taken away. Perks are enforced in code: weekly cashback, a one-off level-up reward, a larger daily free top-up and priority support. Thresholds must increase from tier to tier."
      />
      <Card className="mb-6">
        <CardHeader title="Reward rules" subtitle="Rewards are wager-free credits the player claims; unclaimed ones expire. Not offered to suspended, self-excluded or cooling-off accounts." />
        <CardBody>
          {canEdit ? (
            <RewardSettingsForm settings={rewardSettings} />
          ) : (
            <p className="text-sm text-ink-300">
              Birthday {formatChips(rewardSettings.birthdayAmount)} · cashback from a net loss of {formatChips(rewardSettings.cashbackMinLoss)}, capped at {formatChips(rewardSettings.cashbackMax)} · claim within {rewardSettings.rewardExpiryDays} days
            </p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Tiers" />
        <CardBody className="space-y-5">
          {tiers.map((t) =>
            canEdit ? (
              <div key={t.level} className="rounded-xl border border-white/10 p-4">
                <div className="mb-3 text-xs text-ink-400">Level {t.level}</div>
                <VipTierForm tier={t} />
              </div>
            ) : (
              <div key={t.level} className="flex justify-between border-b border-white/[0.06] pb-2 text-sm">
                <span className="text-ink-100">{t.name}</span>
                <span className="text-ink-400">
                  from {formatChips(t.minWagered)} · cashback {(t.cashbackBp / 100).toFixed(2)}% · level-up {formatChips(t.levelUpReward)} · top-up +{t.topUpBonusPct}% · {t.prioritySupport ? 'priority support' : 'standard support'}
                </span>
              </div>
            ),
          )}
        </CardBody>
      </Card>
    </>
  );
}
