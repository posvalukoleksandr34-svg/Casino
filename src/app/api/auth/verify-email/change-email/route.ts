import { z } from 'zod';
import { AppError } from '@/server/errors';
import { flowUserId, readJson, route } from '@/server/http/handler';
import { emailSchema } from '@/server/users/accounts';
import { changeSignupEmail, VERIFY_LIMITS } from '@/server/users/verification';

const schema = z.object({ email: emailSchema }).strict();

/** Corrects the address of a pending registration and sends a code there. */
export const POST = route({ name: 'auth.verify_email.change', auth: 'public', rateLimit: [VERIFY_LIMITS.sendIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  const userId = flowUserId(ctx.req);
  if (!userId) throw new AppError('UNAUTHENTICATED', 'This verification session has ended. Sign in with your e-mail and password to continue.');
  const res = await changeSignupEmail(userId, body.email, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
  return { sent: res.sent, verification: res.status };
});
