import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { adminCreateDemoFixture } from '@/server/sports/admin';

const schema = z
  .object({
    competitionId: z.string().regex(/^demo-[a-z0-9-]{1,40}$/),
    homeId: z.string().regex(/^demo-[a-z0-9-]{1,40}$/),
    awayId: z.string().regex(/^demo-[a-z0-9-]{1,40}$/),
    kickoffAt: z.iso.datetime({ offset: true }),
    reason: reasonSchema,
  })
  .strict();

/** Schedules an extra fictional demo fixture; prices come from the published model, the result from a committed seed. */
export const POST = route({ name: 'admin.sports.fixture', auth: 'sports:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  const actor = { adminId: ctx.session.userId, ipHash: ctx.ipHash, requestId: ctx.requestId };
  return adminCreateDemoFixture(actor, { competitionId: body.competitionId, homeId: body.homeId, awayId: body.awayId, kickoffAt: new Date(body.kickoffAt) }, body.reason);
});
