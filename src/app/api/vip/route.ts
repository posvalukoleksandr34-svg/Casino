import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { vipOverview } from '@/server/vip/vip';

export const GET = route({ name: 'vip.get', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => vipOverview(session.userId));
