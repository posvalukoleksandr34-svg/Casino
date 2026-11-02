import { z } from 'zod';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { getTicket } from '@/server/support/tickets';

export const GET = route<'user', { ticketId: string }>({ name: 'support.get', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.ticketId).success) throw errors.notFound('Ticket');
  return getTicket(session.userId, params.ticketId);
});
