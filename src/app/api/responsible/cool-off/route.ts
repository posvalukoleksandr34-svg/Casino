import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { withTransaction } from '@/server/db/client';
import { readJson, route } from '@/server/http/handler';
import { startCoolOff } from '@/server/responsible/limits';

const schema = z.object({ hours: z.union([z.literal(24), z.literal(72), z.literal(168), z.literal(720)]) }).strict();

export const POST = route({ name: 'responsible.cool_off', auth: 'user' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return withTransaction(async (tx) => {
    const until = await startCoolOff(tx, ctx.session.userId, body.hours);
    await audit(tx, { actorId: ctx.session.userId, actorType: 'USER', action: 'responsible.cool_off', after: { until }, ipHash: ctx.ipHash });
    return { coolOffUntil: until };
  });
});
