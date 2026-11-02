import { z } from 'zod';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { adminDeposits } from '@/server/payments/admin';

const query = z.object({ status: z.enum(['CREATED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNDER_REVIEW']).optional() });

export const GET = route({ name: 'admin.payments.deposits', auth: 'payments:read', rateLimit: [RATE_LIMITS.adminUser] }, async ({ req }) => ({
  deposits: await adminDeposits({ status: parseQuery(req, query).status }),
}));
