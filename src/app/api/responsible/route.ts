import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { getDb, withTransaction } from '@/server/db/client';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { getLimits, updateLimits } from '@/server/responsible/limits';
import { playTotals } from '@/server/responsible/limits';

const amount = z.int().min(100).max(1_000_000_000_00).nullable();
const schema = z
  .object({
    dailyLossLimit: amount.optional(),
    weeklyLossLimit: amount.optional(),
    dailyWagerLimit: amount.optional(),
    sessionLimitMinutes: z.int().min(5).max(1440).nullable().optional(),
    realityCheckMinutes: z.int().min(5).max(240).nullable().optional(),
  })
  .strict();

export const GET = route({ name: 'responsible.get', auth: 'user' }, async ({ session }) => {
  const db = getDb();
  return { ...(await getLimits(db, session.userId)), usage: await playTotals(db, session.userId, new Date()), sessionStartedAt: session.sessionCreatedAt };
});

export const PUT = route({ name: 'responsible.update', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return withTransaction(async (tx) => {
    const res = await updateLimits(tx, ctx.session.userId, body);
    await audit(tx, {
      actorId: ctx.session.userId,
      actorType: 'USER',
      action: 'responsible.limits_updated',
      after: res,
      ipHash: ctx.ipHash,
    });
    return res;
  });
});
