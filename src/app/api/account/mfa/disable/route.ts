import { z } from 'zod';
import { disableMfa } from '@/server/auth/mfa';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ code: z.string().trim().min(6).max(20) }).strict();

/** Turns two-factor authentication off after a valid authenticator or recovery code. */
export const POST = route({ name: 'account.mfa.disable', auth: 'user' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  await disableMfa(ctx.session, body.code, { ipHash: ctx.ipHash, requestId: ctx.requestId });
  return { enabled: false };
});
