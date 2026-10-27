import { NextResponse } from 'next/server';
import { audit } from '@/server/audit/audit';
import { revokeSession } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { clearFlowCookie, clearSessionCookie, route } from '@/server/http/handler';

/** Ends the session and forgets any pending registration in this browser. */
export const POST = route({ name: 'auth.logout', auth: 'optional', onboarding: 'allow' }, async (ctx) => {
  if (ctx.session) {
    await revokeSession(getDb(), ctx.session.sessionId);
    await audit(getDb(), { actorId: ctx.session.userId, actorType: 'USER', action: 'auth.logout', ipHash: ctx.ipHash });
  }
  return clearFlowCookie(clearSessionCookie(NextResponse.json({ ok: true })));
});
