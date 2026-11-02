import { z } from 'zod';
import { errors } from '@/server/errors';
import { adminCtx } from '@/server/http/admin';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { assignTicket } from '@/server/support/tickets';

export const POST = route<'support:manage', { ticketId: string }>({ name: 'admin.support.assign', auth: 'support:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  if (!z.uuid().safeParse(ctx.params.ticketId).success) throw errors.notFound('Ticket');
  return assignTicket(adminCtx(ctx), ctx.params.ticketId);
});
