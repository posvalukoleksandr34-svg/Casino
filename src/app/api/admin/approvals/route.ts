import { z } from 'zod';
import { listApprovals } from '@/server/admin/approvals';
import { parseQuery, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const query = z.object({ status: z.enum(['open', 'closed']).optional() }).strict();

/** Four-eyes requests the viewer may decide or has made. */
export const GET = route({ name: 'admin.approvals', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  return { requests: await listApprovals(ctx.session, { status: q.status }) };
});
