import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { signInHistory } from '@/server/users/devices';

export const GET = route({ name: 'account.sign_ins', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => ({ events: await signInHistory(session.userId) }));
