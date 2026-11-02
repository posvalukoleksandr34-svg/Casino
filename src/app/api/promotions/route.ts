import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { bonusOverview } from '@/server/promotions/campaigns';

/** The player's bonus dashboard: welcome offers, the active bonus with wagering progress, history. */
export const GET = route({ name: 'promotions.get', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ session }) => bonusOverview(session.userId));
