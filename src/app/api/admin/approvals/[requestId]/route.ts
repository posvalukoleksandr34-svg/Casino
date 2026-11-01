import { z } from 'zod';
import { decideApproval } from '@/server/admin/approvals';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ decision: z.enum(['approve', 'reject', 'cancel']), note: z.string().max(500).optional() }).strict();

/**
 * Approve (and execute), reject or cancel a pending request. The server checks
 * that the decider is a different staff member with the action's permission;
 * the requester may only cancel.
 */
export const POST = route<'admin:access', { requestId: string }>({ name: 'admin.approvals.decide', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return decideApproval(adminCtx(ctx), ctx.params.requestId, body.decision, body.note);
});
