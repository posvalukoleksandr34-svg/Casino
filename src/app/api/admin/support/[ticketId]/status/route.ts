import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { setTicketStatus } from '@/server/support/tickets';

const schema = z.object({ status: z.enum(['OPEN', 'AWAITING_PLAYER', 'RESOLVED', 'CLOSED']), reason: reasonSchema }).strict();

export const POST = route<'support:manage', { ticketId: string }>({ name: 'admin.support.status', auth: 'support:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.ticketId).success) throw errors.notFound('Ticket');
  const body = await readJson(ctx.req, schema);
  return setTicketStatus(adminCtx(ctx), ctx.params.ticketId, body.status, body.reason);
});
