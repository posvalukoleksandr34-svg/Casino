import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listDevices } from '@/server/users/devices';

export const GET = route({ name: 'account.sessions', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => ({ sessions: await listDevices(session.userId, session.sessionId) }));
