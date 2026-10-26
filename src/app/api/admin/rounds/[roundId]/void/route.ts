import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { voidRound } from '@/server/games/round-service';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ reason: reasonSchema }).strict();

/** Voids an OPEN round and refunds the stake in full. Settled rounds cannot be voided. */
export const POST = route<'rounds:void', { roundId: string }>({ name: 'admin.round.void', auth: 'rounds:void' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return voidRound({ roundId: z.uuid().parse(ctx.params.roundId), adminId: ctx.session.userId, reason: body.reason, ipHash: ctx.ipHash, requestId: ctx.requestId });
});
