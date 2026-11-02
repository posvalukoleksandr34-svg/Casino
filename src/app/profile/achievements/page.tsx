import { AccountTabs } from '@/components/account/account-tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { evaluateAchievements } from '@/server/achievements/achievements';
import { requireUser } from '@/server/auth/current';

export const metadata = { title: 'Achievements' };

export default async function AchievementsPage() {
  const session = await requireUser('/profile/achievements');
  const achievements = await evaluateAchievements(session.userId);
  const earned = achievements.filter((a) => a.earned).length;
  return (
    <>
      <PageHeader eyebrow="Profile" title="Achievements" subtitle={`${earned} of ${achievements.length} earned. Badges are cosmetic: they carry no credits, prizes or value.`} />
      <AccountTabs />
      <Card>
        <CardBody>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="achievements-page">
            {achievements.map((a) => (
              <li key={a.id} className={a.earned ? 'surface-raised border-gold-700/60 px-4 py-3' : 'rounded-xl border border-dashed border-ink-700 px-4 py-3'} data-earned={a.earned}>
                <div className="flex items-center justify-between gap-2">
                  <span className={a.earned ? 'font-semibold text-gold-200' : 'font-semibold text-ink-300'}>{a.title}</span>
                  {a.earned ? <Badge tone="gold">Earned</Badge> : <Badge>Not yet</Badge>}
                </div>
                <p className="mt-1 text-xs text-ink-400">{a.earned ? a.description : a.hint}</p>
                {a.awardedAt && <p className="mt-1 text-[11px] text-ink-400">{new Date(a.awardedAt).toLocaleDateString()}</p>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
