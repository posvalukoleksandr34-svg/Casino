import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clearSessionCookie, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { deleteAccount } from '@/server/users/accounts';

const schema = z.object({ password: z.string().min(1).max(200), confirm: z.literal('DELETE') }).strict();

export const DELETE = route({ name: 'account.delete', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  await deleteAccount(ctx.session.userId, body.password, { ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
