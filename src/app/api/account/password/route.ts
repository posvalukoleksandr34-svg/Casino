import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { changePassword } from '@/server/users/accounts';

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }).strict();

export const POST = route({ name: 'account.password', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  await changePassword(ctx.session.userId, ctx.session.sessionId, body.currentPassword, body.newPassword, {
    ipHash: ctx.ipHash,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
});
