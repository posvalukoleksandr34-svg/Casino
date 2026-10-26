import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { withTransaction } from '@/server/db/client';
import { readJson, route } from '@/server/http/handler';
import { selfExclude } from '@/server/responsible/limits';

const schema = z
  .object({
    months: z.union([z.literal(6), z.literal(12), z.literal(60), z.null()]),
    confirm: z.literal('EXCLUDE'),
  })
  .strict();

export const POST = route({ name: 'responsible.self_exclusion', auth: 'user' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return withTransaction(async (tx) => {
    const until = await selfExclude(tx, ctx.session.userId, body.months);
    await audit(tx, { actorId: ctx.session.userId, actorType: 'USER', action: 'responsible.self_excluded', after: { until }, ipHash: ctx.ipHash });
    return { selfExcludedUntil: until };
  });
});
