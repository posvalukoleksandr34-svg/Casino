import { z } from 'zod';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { signOutDevice } from '@/server/users/devices';

/** Signs one of the player's own devices out (revokes that session). */
export const DELETE = route<'user', { sessionId: string }>({ name: 'account.session_revoke', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ params, session, ipHash }) => {
  if (!z.uuid().safeParse(params.sessionId).success) throw errors.notFound('Session');
  return signOutDevice(session.userId, params.sessionId, { ipHash });
});
