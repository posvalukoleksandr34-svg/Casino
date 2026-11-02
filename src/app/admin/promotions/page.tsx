import { CampaignActions, CreateCampaign } from '@/components/admin/promotion-controls';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chips, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/rbac';
import { campaignClaims, listCampaigns } from '@/server/promotions/admin';

export const metadata = { title: 'Promotions' };

export default async function AdminPromotionsPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const session = await requirePermission('admin:access');
  const canManage = hasPermission(session.role, 'promotions:manage');
  const [campaigns, sp] = await Promise.all([listCampaigns(), searchParams]);
  const selected = sp.campaign ? Number(sp.campaign) : null;
  const claims = selected && Number.isInteger(selected) ? await campaignClaims(selected) : null;
  const now = Date.now();
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Promotions"
        subtitle="Welcome offers and promo codes. Bonus credits are virtual. A claim fixes its own terms; a campaign's money terms cannot change once anyone has claimed it. Every change is audited with a reason."
      />
      <Card>
        <CardHeader title="Campaigns" />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Terms</Th>
                <Th className="text-right">Claims</Th>
                <Th className="text-right">Granted / released</Th>
                <Th>Status</Th>
                {canManage && <Th />}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const ended = Boolean(c.endsAt && Date.parse(c.endsAt) <= now);
                return (
                  <Tr key={c.id}>
                    <Td>
                      <a href={`?campaign=${c.id}`} className="font-medium text-ink-100 hover:text-gold-300">
                        {c.name}
                      </a>
                      <div className="text-xs text-ink-400">
                        {c.kind === 'PROMO_CODE' ? <span className="num">{c.code}</span> : 'Welcome offer'} · {c.slug}
                      </div>
                    </Td>
                    <Td className="text-xs text-ink-300">
                      {c.fixedAmount > 0 && (
                        <>
                          <Chips amount={c.fixedAmount} suffix={false} /> fixed{' '}
                        </>
                      )}
                      {c.matchPercent > 0 && <>{c.matchPercent}% match </>}· max <Chips amount={c.maxBonus} suffix={false} /> · wager ×{c.wageringMultiplier} · {c.expiresAfterDays} d
                      {c.maxClaims && <> · cap {c.maxClaims}</>}
                    </Td>
                    <Td className="num text-right">
                      {c.stats.claims} <span className="text-xs text-ink-400">({c.stats.active} active)</span>
                    </Td>
                    <Td className="num text-right">
                      <Chips amount={c.stats.granted} suffix={false} /> / <Chips amount={c.stats.released} suffix={false} />
                    </Td>
                    <Td>{ended ? <Badge>Ended</Badge> : c.active ? <Badge tone="positive">Active</Badge> : <Badge tone="warning">Paused</Badge>}</Td>
                    {canManage && (
                      <Td>
                        <CampaignActions id={c.id} active={c.active} ended={ended} />
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      {claims && (
        <Card className="mt-6">
          <CardHeader title="Claims" subtitle={campaigns.find((c) => c.id === selected)?.name} />
          <CardBody>
            {claims.length === 0 ? (
              <p className="text-sm text-ink-400">No claims yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Player</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-right">Wagering</Th>
                    <Th>Status</Th>
                    <Th>Claimed</Th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <a href={`/admin/users/${c.userId}`} className="hover:text-gold-300">
                          {c.username}
                        </a>
                      </Td>
                      <Td className="num text-right">
                        <Chips amount={c.amount} suffix={false} />
                      </Td>
                      <Td className="num text-right">
                        <Chips amount={c.wageringProgress} suffix={false} /> / <Chips amount={c.wageringRequired} suffix={false} />
                      </Td>
                      <Td>{c.status}</Td>
                      <Td className="whitespace-nowrap text-ink-400">{new Date(c.claimedAt).toLocaleString()}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {canManage && (
        <Card className="mt-6">
          <CardHeader title="New campaign" subtitle="Promo codes are case-insensitive for players. Keep wagering multiples moderate: without withdrawals they only add play." />
          <CardBody>
            <CreateCampaign />
          </CardBody>
        </Card>
      )}
    </>
  );
}
