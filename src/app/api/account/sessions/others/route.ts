import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { signOutOtherDevices } from '@/server/users/devices';

/** Signs out every other device; this one stays signed in. */
export const POST = route({ name: 'account.sessions_revoke_others', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ session, ipHash }) => signOutOtherDevices(session.userId, session.sessionId, { ipHash }));
