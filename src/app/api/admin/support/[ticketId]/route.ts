import { z } from 'zod';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { staffTicket } from '@/server/support/tickets';

export const GET = route<'support:manage', { ticketId: string }>({ name: 'admin.support.ticket', auth: 'support:manage', rateLimit: [RATE_LIMITS.adminUser] }, async ({ params }) => {
  if (!z.uuid().safeParse(params.ticketId).success) throw errors.notFound('Ticket');
  return staffTicket(params.ticketId);
});
