import { VipTierForm } from '@/components/admin/compliance-controls';
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
  const tiers = await loadTiers(getDb());
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="VIP tiers"
        subtitle="Tiers follow lifetime casino wagering and are never taken away. Perks are enforced in code: a larger daily free top-up and priority support. Thresholds must increase from tier to tier."
      />
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
                  from {formatChips(t.minWagered)} · top-up +{t.topUpBonusPct}% · {t.prioritySupport ? 'priority support' : 'standard support'}
                </span>
              </div>
            ),
          )}
        </CardBody>
      </Card>
    </>
  );
}
