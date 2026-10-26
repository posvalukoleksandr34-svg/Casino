import { FundHouse, KillSwitch, PlatformLimitsEditor } from '@/components/admin/platform-controls';
import { Meter } from '@/components/admin/charts';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader, Stat } from '@/components/ui/misc';
import { overview } from '@/server/admin/admin-service';
import { hasPermission } from '@/server/auth/rbac';
import { requirePermission } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { getPlatformSettings } from '@/server/risk/risk-service';

export const metadata = { title: 'Risk & platform' };

export default async function AdminRiskPage() {
  const session = await requirePermission('admin:access');
  const [settings, o] = await Promise.all([getPlatformSettings(getDb()), overview()]);
  const canRisk = hasPermission(session.role, 'risk:manage');
  const canFund = hasPermission(session.role, 'house:fund');
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Risk & platform controls"
        subtitle="The risk engine evaluates every wager before the outcome is drawn: stake limits, max payout per round, per-game and total exposure, the house reserve floor and the player balance cap. It never alters probabilities or payouts, and never uses the player's identity or history."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Incident controls" />
          <CardBody className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-300">New rounds</span>
              <StatusBadge status={settings.newRoundsEnabled ? 'ACTIVE' : 'SUSPENDED'} />
            </div>
            {settings.incidentMessage && <p className="text-ink-400">Banner: {settings.incidentMessage}</p>}
            {canRisk && <KillSwitch settings={settings} />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Reserve" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Stat label="House bankroll" value={<Chips amount={o.reserves.houseBalance} compact />} />
              <Stat label="Headroom" value={<Chips amount={o.reserves.availableHeadroom} compact />} />
            </div>
            <Meter label="Open exposure vs platform limit" value={o.reserves.openNetExposure} limit={settings.maxTotalExposure} />
            {canFund && <FundHouse />}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Platform limits" actions={canRisk ? <PlatformLimitsEditor settings={settings} /> : undefined} />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Stat label="Max total open exposure" value={<Chips amount={settings.maxTotalExposure} compact />} />
            <Stat label="Minimum house reserve" value={<Chips amount={settings.minHouseReserve} compact />} />
            <Stat label="Max player balance" value={<Chips amount={settings.maxPlayerBalance} compact />} />
            <Stat label="Signup bonus" value={<Chips amount={settings.signupBonus} compact />} />
            <Stat label="Daily bonus" value={<Chips amount={settings.dailyBonus} compact />} sub={<>while balance below <Chips amount={settings.dailyBonusMaxBalance} suffix={false} /></>} />
            <Stat label="Anomaly threshold" value={`${settings.anomalyZThreshold}σ`} sub="Minimum 200 rounds per window" />
          </CardBody>
        </Card>
      </div>
      <p className="mt-6 text-xs text-ink-500">
        Reserve requirement analysis (Monte Carlo) is available offline via <code>npm run sim:risk</code>; results are documented in docs/risk.md and are never mixed with live figures.
      </p>
    </>
  );
}
