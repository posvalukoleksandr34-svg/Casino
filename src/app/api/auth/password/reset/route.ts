import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { resetPassword } from '@/server/users/accounts';

const schema = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(200) }).strict();

export const POST = route({ name: 'auth.password.reset', auth: 'public', rateLimit: [RATE_LIMITS.passwordResetIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  await resetPassword(body.token, body.password, { ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  return { ok: true };
});
