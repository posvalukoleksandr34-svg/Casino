import { z } from 'zod';
import { reasonSchema, riskLimitsSchema, updateRiskLimits } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ limits: riskLimitsSchema, reason: reasonSchema }).strict();

export const PUT = route<'risk:manage', { gameId: string }>({ name: 'admin.game.limits', auth: 'risk:manage' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return updateRiskLimits(adminCtx(ctx), ctx.params.gameId, body.limits, body.reason);
});
