import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { campaignCreateSchema, createCampaign, listCampaigns } from '@/server/promotions/admin';

export const GET = route({ name: 'admin.promotions.list', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ campaigns: await listCampaigns() }));

const createSchema = z.object({ campaign: campaignCreateSchema, reason: reasonSchema }).strict();

/** Creates a welcome offer or promo-code campaign (virtual bonus credits). Audited with a reason. */
export const POST = route({ name: 'admin.promotions.create', auth: 'promotions:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, createSchema);
  return { campaign: await createCampaign(adminCtx(ctx), body.campaign, body.reason) };
});
