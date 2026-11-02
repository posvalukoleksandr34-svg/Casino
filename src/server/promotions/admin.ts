/**
 * Back-office management of bonus campaigns (permission promotions:manage).
 *
 * A claim fixes its own terms (amount, wagering requirement, deadline) when it
 * is made, so editing a campaign never changes bonuses already claimed. The
 * money terms of a campaign (match %, fixed amount, cap, wagering multiple,
 * expiry) cannot be edited once anyone has claimed it: end it and create a new
 * one instead. Every change is an audited admin action with a reason.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAdminAction } from '../audit/audit';
import { getDb, withTransaction } from '../db/client';
import { bonusCampaigns, bonusClaims, users } from '../db/schema';
import { errors } from '../errors';
import type { AdminCtx } from '../admin/admin-service';

const terms = {
  matchPercent: z.int().min(0).max(200),
  fixedAmount: z.int().min(0).max(10_000_000),
  maxBonus: z.int().min(1).max(10_000_000),
  wageringMultiplier: z.int().min(0).max(20),
  expiresAfterDays: z.int().min(1).max(90),
};

export const campaignCreateSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{3,40}$/, 'Slug: 3–40 lower-case letters, digits or dashes'),
    kind: z.enum(['WELCOME', 'PROMO_CODE']),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,20}$/, 'Code: 4–20 letters or digits')
      .nullable()
      .optional(),
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().min(3).max(400),
    ...terms,
    eligibleAccountAgeDays: z.int().min(1).max(3650).nullable().optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
    maxClaims: z.int().min(1).max(10_000_000).nullable().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.kind === 'PROMO_CODE' && !c.code) ctx.addIssue({ code: 'custom', message: 'A promo-code campaign needs a code', path: ['code'] });
    if (c.kind === 'WELCOME' && c.code) ctx.addIssue({ code: 'custom', message: 'A welcome offer has no code', path: ['code'] });
    if (c.matchPercent === 0 && c.fixedAmount === 0) ctx.addIssue({ code: 'custom', message: 'Give a match % or a fixed amount', path: ['fixedAmount'] });
    if (c.endsAt && c.startsAt && Date.parse(c.endsAt) <= Date.parse(c.startsAt)) ctx.addIssue({ code: 'custom', message: 'The end must be after the start', path: ['endsAt'] });
  });

export const campaignPatchSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().min(3).max(400),
    active: z.boolean(),
    endsAt: z.iso.datetime().nullable(),
    maxClaims: z.int().min(1).max(10_000_000).nullable(),
    eligibleAccountAgeDays: z.int().min(1).max(3650).nullable(),
    ...terms,
  })
  .partial()
  .strict();

const TERM_KEYS = Object.keys(terms) as (keyof typeof terms)[];

export async function listCampaigns() {
  const res = await getDb().execute<{
    id: string;
    claims: string;
    active_claims: string;
    completed: string;
    granted: string;
    released: string;
  }>(sql`
    SELECT campaign_id::text AS id, count(*)::text AS claims,
           count(*) FILTER (WHERE status = 'ACTIVE')::text AS active_claims,
           count(*) FILTER (WHERE status = 'COMPLETED')::text AS completed,
           sum(amount)::text AS granted,
           coalesce(sum(amount) FILTER (WHERE status = 'COMPLETED'), 0)::text AS released
    FROM bonus_claims GROUP BY campaign_id`);
  const stats = new Map(res.rows.map((r) => [Number(r.id), r]));
  const rows = await getDb().select().from(bonusCampaigns).orderBy(desc(bonusCampaigns.createdAt));
  return rows.map((c) => {
    const s = stats.get(c.id);
    return {
      ...c,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      stats: {
        claims: Number(s?.claims ?? 0),
        active: Number(s?.active_claims ?? 0),
        completed: Number(s?.completed ?? 0),
        granted: Number(s?.granted ?? 0),
        released: Number(s?.released ?? 0),
      },
    };
  });
}

export async function campaignClaims(campaignId: number, limit = 100) {
  const rows = await getDb()
    .select({ claim: bonusClaims, username: users.username })
    .from(bonusClaims)
    .innerJoin(users, eq(users.id, bonusClaims.userId))
    .where(eq(bonusClaims.campaignId, campaignId))
    .orderBy(desc(bonusClaims.claimedAt))
    .limit(limit);
  return rows.map(({ claim: c, username }) => ({
    id: c.id,
    userId: c.userId,
    username,
    amount: c.amount,
    wageringRequired: c.wageringRequired,
    wageringProgress: c.wageringProgress,
    status: c.status,
    claimedAt: c.claimedAt.toISOString(),
    closedAt: c.closedAt?.toISOString() ?? null,
  }));
}

export async function createCampaign(ctx: AdminCtx, input: z.infer<typeof campaignCreateSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const values = {
      slug: input.slug,
      kind: input.kind,
      code: input.kind === 'PROMO_CODE' ? input.code! : null,
      name: input.name,
      description: input.description,
      matchPercent: input.matchPercent,
      fixedAmount: input.fixedAmount,
      maxBonus: input.maxBonus,
      wageringMultiplier: input.wageringMultiplier,
      expiresAfterDays: input.expiresAfterDays,
      eligibleAccountAgeDays: input.eligibleAccountAgeDays ?? null,
      startsAt: input.startsAt ? new Date(input.startsAt) : new Date(),
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      maxClaims: input.maxClaims ?? null,
      createdBy: ctx.adminId,
    };
    const clash = await tx
      .select({ id: bonusCampaigns.id })
      .from(bonusCampaigns)
      .where(values.code ? sql`${bonusCampaigns.slug} = ${values.slug} OR ${bonusCampaigns.code} = ${values.code}` : eq(bonusCampaigns.slug, values.slug));
    if (clash.length) throw errors.conflict('A campaign with this slug or code already exists');
    const [row] = await tx.insert(bonusCampaigns).values(values).returning();
    await recordAdminAction(tx, { ...ctx, action: 'promotions.campaign_created', targetType: 'bonus_campaign', targetId: String(row!.id), reason, before: null, after: { ...values, startsAt: values.startsAt.toISOString(), endsAt: values.endsAt?.toISOString() ?? null } });
    return row!;
  });
}

export async function updateCampaign(ctx: AdminCtx, id: number, patch: z.infer<typeof campaignPatchSchema>, reason: string) {
  return withTransaction(async (tx) => {
    const [before] = await tx.select().from(bonusCampaigns).where(eq(bonusCampaigns.id, id)).for('update');
    if (!before) throw errors.notFound('Campaign');
    const changesTerms = TERM_KEYS.some((k) => patch[k] !== undefined && patch[k] !== before[k]);
    if (changesTerms) {
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(bonusClaims).where(eq(bonusClaims.campaignId, id));
      if ((n?.n ?? 0) > 0) throw errors.conflict('This campaign has been claimed: its terms are fixed. End it and create a new campaign instead.');
    }
    const next = { ...before, ...patch, endsAt: patch.endsAt === undefined ? before.endsAt : patch.endsAt ? new Date(patch.endsAt) : null };
    if (next.matchPercent === 0 && next.fixedAmount === 0) throw errors.validation('Give a match % or a fixed amount');
    if (next.endsAt && next.endsAt <= next.startsAt) throw errors.validation('The end must be after the start');
    const set = { ...patch, endsAt: next.endsAt, updatedAt: new Date() };
    await tx.update(bonusCampaigns).set(set).where(eq(bonusCampaigns.id, id));
    const prev: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) prev[k] = (before as Record<string, unknown>)[k] instanceof Date ? ((before as Record<string, unknown>)[k] as Date).toISOString() : (before as Record<string, unknown>)[k];
    await recordAdminAction(tx, { ...ctx, action: 'promotions.campaign_updated', targetType: 'bonus_campaign', targetId: String(id), reason, before: prev, after: patch });
    return { id };
  });
}
