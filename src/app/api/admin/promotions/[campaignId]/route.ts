import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { campaignClaims, campaignPatchSchema, updateCampaign } from '@/server/promotions/admin';

const id = (raw: string) => z.coerce.number().int().positive().parse(raw);

/** Claims of one campaign (who, how much, wagering progress, status). */
export const GET = route<'admin:access', { campaignId: string }>({ name: 'admin.promotions.claims', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => ({
  claims: await campaignClaims(id(ctx.params.campaignId)),
}));

const patchSchema = z.object({ patch: campaignPatchSchema, reason: reasonSchema }).strict();

/** Edits, pauses or ends a campaign. Money terms are fixed once anyone has claimed it. */
export const PATCH = route<'promotions:manage', { campaignId: string }>({ name: 'admin.promotions.update', auth: 'promotions:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, patchSchema);
  return updateCampaign(adminCtx(ctx), id(ctx.params.campaignId), body.patch, body.reason);
});
