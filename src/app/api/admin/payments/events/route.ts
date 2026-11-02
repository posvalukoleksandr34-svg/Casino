import { z } from 'zod';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { adminPaymentEvents } from '@/server/payments/admin';

const query = z.object({ invalid: z.enum(['1']).optional() });

export const GET = route({ name: 'admin.payments.events', auth: 'payments:read', rateLimit: [RATE_LIMITS.adminUser] }, async ({ req }) => ({
  events: await adminPaymentEvents({ invalidOnly: parseQuery(req, query).invalid === '1' }),
}));
