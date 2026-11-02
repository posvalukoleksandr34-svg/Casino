import { z } from 'zod';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { closeTicket } from '@/server/support/tickets';

export const POST = route<'user', { ticketId: string }>({ name: 'support.close', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.ticketId).success) throw errors.notFound('Ticket');
  return { ticket: await closeTicket(session.userId, params.ticketId) };
});
