import { z } from 'zod';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { supportQueue } from '@/server/support/tickets';

const query = z.object({ view: z.enum(['open', 'all']).default('open') });

export const GET = route({ name: 'admin.support.queue', auth: 'support:manage', rateLimit: [RATE_LIMITS.adminUser] }, async ({ req }) => ({ tickets: await supportQueue(parseQuery(req, query).view) }));
