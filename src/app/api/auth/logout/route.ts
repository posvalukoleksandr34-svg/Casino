import { NextResponse } from 'next/server';
import { audit } from '@/server/audit/audit';
import { revokeSession } from '@/server/auth/sessions';
import { getDb } from '@/server/db/client';
import { clearSessionCookie, route } from '@/server/http/handler';

export const POST = route({ name: 'auth.logout', auth: 'optional' }, async (ctx) => {
  if (ctx.session) {
    await revokeSession(getDb(), ctx.session.sessionId);
    await audit(getDb(), { actorId: ctx.session.userId, actorType: 'USER', action: 'auth.logout', ipHash: ctx.ipHash });
  }
  return clearSessionCookie(NextResponse.json({ ok: true }));
});
