import { z } from 'zod';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { requestPasswordReset } from '@/server/users/accounts';

const schema = z.object({ email: z.string().max(254) }).strict();

/** Always returns the same response so the endpoint cannot be used to enumerate accounts. */
export const POST = route({ name: 'auth.password.forgot', auth: 'public', rateLimit: [RATE_LIMITS.passwordResetIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  await requestPasswordReset(body.email, { ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  return { ok: true, message: 'If an account exists for that address, a reset link has been sent.' };
});
