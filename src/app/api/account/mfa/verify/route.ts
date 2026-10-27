import { z } from 'zod';
import { verifySession } from '@/server/auth/mfa';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ code: z.string().trim().min(6).max(20) }).strict();

/** Proves the second factor on the current session (e.g. one created before MFA was turned on). */
export const POST = route({ name: 'account.mfa.verify', auth: 'user' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return verifySession(ctx.session, body.code, { ipHash: ctx.ipHash, requestId: ctx.requestId });
});
