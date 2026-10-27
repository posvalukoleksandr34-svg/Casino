import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/server/errors';
import { clearFlowCookie, flowUserId, readJson, route, withSessionCookie } from '@/server/http/handler';
import { signupStatus, verifySignupCode, VERIFY_LIMITS } from '@/server/users/verification';

const FLOW_ENDED = 'This verification session has ended. Sign in with your e-mail and password to continue.';

/** State of the pending registration named by the signup-flow cookie (never the code). */
export const GET = route({ name: 'auth.verify_email.status', auth: 'public' }, async (ctx) => {
  const userId = flowUserId(ctx.req);
  const status = userId ? await signupStatus(userId) : null;
  if (!status) return clearFlowCookie(NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: FLOW_ENDED, details: null, requestId: ctx.requestId } }, { status: 401 }));
  return { verification: status };
});

const schema = z.object({ code: z.string().max(20) }).strict();

/** Step 2: the code activates the account (wallet, seeds, limits, welcome chips) and signs the player in. */
export const POST = route({ name: 'auth.verify_email', auth: 'public', rateLimit: [VERIFY_LIMITS.verifyIp] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  const userId = flowUserId(ctx.req);
  if (!userId) throw new AppError('UNAUTHENTICATED', FLOW_ENDED);
  const res = await verifySignupCode(userId, body.code.replace(/\D/g, ''), { ipHash: ctx.ipHash, userAgent: ctx.userAgent, requestId: ctx.requestId });
  return clearFlowCookie(
    withSessionCookie(NextResponse.json({ verified: true, next: '/onboarding', signupBonus: res.signupBonus }), res.session.token, res.session.expiresAt),
  );
});
