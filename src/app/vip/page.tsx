import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { pageSession } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { loadTiers, vipOverview } from '@/server/vip/vip';

export const metadata = { title: 'VIP' };

export default async function VipPage() {
  const session = await pageSession();
  const me = session ? await vipOverview(session.userId) : null;
  const tiers = me?.tiers ?? (await loadTiers(getDb()));
  const pct = me?.next ? Math.min(100, (me.wagered / me.next.minWagered) * 100) : 100;
  return (
    <>
      <PageHeader
        eyebrow="Loyalty"
        title="VIP tiers"
        subtitle="Tiers follow your lifetime wagering in casino games and are never taken away. These are the only perks; there are no hidden conditions and no deposit is needed to move up."
      />
      {me && (
        <Card className="mb-6">
          <CardBody className="space-y-3" data-testid="vip-progress">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">Your tier</div>
                <div className="font-display text-3xl text-gold-200">{me.current?.name}</div>
              </div>
              <div className="text-right text-sm text-ink-300">
                Wagered <Chips amount={me.wagered} />
              </div>
            </div>
            {me.next ? (
              <>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-label={`Progress to ${me.next.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                  <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-300" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-sm text-ink-400">
                  <Chips amount={me.next.remaining} /> more to wager for {me.next.name}.
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-400">You are in the highest tier.</p>
            )}
            <p className="text-xs text-ink-400">
              Please only play what you can afford to lose. Moving up a tier is not a reason to play more: <Link href="/responsible-play" className="text-gold-300">set limits</Link>.
            </p>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Tiers and perks" />
        <CardBody>
          <Table data-testid="vip-tiers">
            <thead>
              <tr>
                <Th>Tier</Th>
                <Th className="text-right">Lifetime wagering</Th>
                <Th>Daily free top-up</Th>
                <Th>Support</Th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <Tr key={t.level}>
                  <Td>
                    <span className="font-medium text-ink-100">{t.name}</span> {me?.current?.level === t.level && <Badge tone="gold">You</Badge>}
                  </Td>
                  <Td className="text-right">{t.minWagered === 0 ? 'From the start' : <>from <Chips amount={t.minWagered} suffix={false} /></>}</Td>
                  <Td>{t.topUpBonusPct ? `+${t.topUpBonusPct}%` : 'Standard'}</Td>
                  <Td>{t.prioritySupport ? 'Priority queue' : 'Standard queue'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
