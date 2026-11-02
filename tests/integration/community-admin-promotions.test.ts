import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { adminActions, bonusCampaigns, users } from '@/server/db/schema';
import { AppError } from '@/server/errors';
import { startRound } from '@/server/games/round-service';
import { campaignClaims, createCampaign, listCampaigns, updateCampaign } from '@/server/promotions/admin';
import { claimBonus } from '@/server/promotions/campaigns';
import { updatePreferences } from '@/server/users/accounts';
import { levelBoard, weeklyMultipliers } from '@/server/users/leaderboard';
import { playerLevel, XP } from '@/server/users/levels';
import { liveSnapshot } from '@/server/live/feed';
import { expectLedgerConsistent, key, newPlayer } from './helpers';

const db = () => getDb();
const code = (e: unknown) => (e instanceof AppError ? e.code : String(e));

async function admin() {
  const a = await newPlayer('promo-admin');
  await db().update(users).set({ role: 'ADMIN' }).where(eq(users.id, a.userId));
  return { adminId: a.userId, ipHash: null, requestId: 'test-request' };
}

async function dice(userId: string, n: number, target = 5000) {
  for (let i = 0; i < n; i++) await startRound({ userId, gameId: 'dice', bet: { amount: 100, target, direction: 'under' }, idempotencyKey: key() });
}

describe('levels', () => {
  it('XP counts at most 30 rounds per UTC day, games tried and achievements', async () => {
    const p = await newPlayer('levels');
    await dice(p.userId, 35);
    const l = await playerLevel(db(), p.userId);
    // 35 rounds today count as 30; one game tried; achievements may include "first round".
    const [ach] = (await db().execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM user_achievements WHERE user_id = ${p.userId}`)).rows;
    expect(l.xp).toBe(XP.roundsPerDayCap * XP.perRound + XP.perGame + Number(ach!.n) * XP.perAchievement);
    expect(l.level).toBeGreaterThanOrEqual(1);
  });
});

describe('leaderboard privacy', () => {
  it('only opted-in players are listed; others see themselves privately and never each other', async () => {
    const shown = await newPlayer('lb-shown');
    const hidden = await newPlayer('lb-hidden');
    await updatePreferences(shown.userId, { publicName: true });
    // A guaranteed-looking win is not needed: any payout counts towards "best multiplier".
    await dice(shown.userId, 6, 9000);
    await dice(hidden.userId, 6, 9000);
    const [shownName] = (await db().select({ u: users.username }).from(users).where(eq(users.id, shown.userId))).map((r) => r.u);
    const [hiddenName] = (await db().select({ u: users.username }).from(users).where(eq(users.id, hidden.userId))).map((r) => r.u);

    const anon = await weeklyMultipliers(null, 1000);
    expect(anon.top.map((r) => r.name)).toContain(shownName);
    expect(anon.top.map((r) => r.name)).not.toContain(hiddenName);
    expect(anon.you).toBeNull();

    const asShown = await weeklyMultipliers(shown.userId, 1000);
    expect(asShown.top.map((r) => r.name)).not.toContain(hiddenName);
    const asHidden = await weeklyMultipliers(hidden.userId, 1000);
    expect(asHidden.you).not.toBeNull();
    expect(asHidden.top.filter((r) => r.you).every((r) => r.name === hiddenName)).toBe(true);

    const levels = await levelBoard(null, 1000);
    expect(levels.top.map((r) => r.name)).toContain(shownName);
    expect(levels.top.map((r) => r.name)).not.toContain(hiddenName);
  });

  it('the live feed names only opted-in players and exposes no ids or balances', async () => {
    const snap = await liveSnapshot(Date.now() + 60_000);
    for (const w of snap.wins) {
      expect(Object.keys(w).sort()).toEqual(['at', 'game', 'gameId', 'multiplierE2', 'payout', 'player']);
      expect(w.multiplierE2).toBeGreaterThanOrEqual(500);
    }
    const named = snap.wins.filter((w) => w.player !== 'A player').map((w) => w.player);
    if (named.length) {
      const optedIn = await db().execute<{ name: string }>(sql`SELECT coalesce(display_name, username) AS name FROM users WHERE (preferences->>'publicName')::boolean IS TRUE`);
      const allowed = new Set(optedIn.rows.map((r) => r.name));
      for (const n of named) expect(allowed.has(n)).toBe(true);
    }
    expect(typeof snap.online).toBe('number');
  });
});

describe('admin: promotion campaigns', () => {
  it('creates a promo code (audited), shows its claims, and locks money terms once claimed', async () => {
    const ctx = await admin();
    const suffix = Date.now().toString(36).toUpperCase();
    const c = await createCampaign(
      ctx,
      {
        slug: `test-${suffix.toLowerCase()}`,
        kind: 'PROMO_CODE',
        code: `ADM${suffix}`.slice(0, 20),
        name: 'Admin test code',
        description: 'Created by a test',
        matchPercent: 0,
        fixedAmount: 25_000,
        maxBonus: 25_000,
        wageringMultiplier: 1,
        expiresAfterDays: 7,
      },
      'Integration test campaign',
    );
    const [action] = await db().select().from(adminActions).where(eq(adminActions.targetId, String(c.id)));
    expect(action?.action).toBe('promotions.campaign_created');
    expect(action?.adminId).toBe(ctx.adminId);

    // Before any claim, terms can change.
    await updateCampaign(ctx, c.id, { fixedAmount: 30_000, maxBonus: 30_000 }, 'Adjust before launch');
    const p = await newPlayer('admin-claim');
    await claimBonus(p.userId, { code: c.code!.toLowerCase() });
    const claims = await campaignClaims(c.id);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.amount).toBe(30_000);

    // After a claim, money terms are fixed; name, pause and end still work.
    await expect(updateCampaign(ctx, c.id, { fixedAmount: 99_000 }, 'Try to change terms')).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    await updateCampaign(ctx, c.id, { active: false, name: 'Admin test code (paused)' }, 'Pause it');
    const q = await newPlayer('admin-paused');
    await expect(claimBonus(q.userId, { code: c.code! })).rejects.toSatisfy((e) => /no longer available/.test((e as Error).message));
    const listed = (await listCampaigns()).find((x) => x.id === c.id)!;
    expect(listed.stats.claims).toBe(1);
    expect(listed.stats.granted).toBe(30_000);
    await expectLedgerConsistent();
  });

  it('refuses a duplicate code or slug, a code on a welcome offer, and a campaign that gives nothing', async () => {
    const ctx = await admin();
    const [welcome] = await db().select().from(bonusCampaigns).where(eq(bonusCampaigns.slug, 'welcome'));
    const base = { kind: 'PROMO_CODE' as const, name: 'Dup', description: 'Duplicate', matchPercent: 0, fixedAmount: 100, maxBonus: 100, wageringMultiplier: 1, expiresAfterDays: 7 };
    await expect(createCampaign(ctx, { ...base, slug: welcome!.slug, code: 'UNIQUE12345' }, 'Duplicate slug')).rejects.toSatisfy((e) => code(e) === 'CONFLICT');
    const { campaignCreateSchema } = await import('@/server/promotions/admin');
    expect(campaignCreateSchema.safeParse({ ...base, slug: 'abc-def', kind: 'WELCOME', code: 'NOPE1234' }).success).toBe(false);
    expect(campaignCreateSchema.safeParse({ ...base, slug: 'abc-def', code: 'ZERO1234', fixedAmount: 0 }).success).toBe(false);
    expect(campaignCreateSchema.safeParse({ ...base, slug: 'abc-def', code: 'MANY1234', wageringMultiplier: 50 }).success).toBe(false);
  });
});
