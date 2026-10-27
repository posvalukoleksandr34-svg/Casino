import { z } from 'zod';
import { confirmEnrollment } from '@/server/auth/mfa';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }).strict();

/** Turns two-factor authentication on; returns the recovery codes once. Other sessions are signed out. */
export const POST = route({ name: 'account.mfa.confirm', auth: 'user', rateLimit: [RATE_LIMITS.mfaUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return confirmEnrollment(ctx.session, body.code, { ipHash: ctx.ipHash, requestId: ctx.requestId });
});
