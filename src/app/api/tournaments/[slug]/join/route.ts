import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { joinTournament } from '@/server/tournaments/tournaments';

export const POST = route<'user', { slug: string }>({ name: 'tournaments.join', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async ({ params, session }) => {
  if (!/^[a-z0-9-]{3,40}$/.test(params.slug)) throw errors.notFound('Tournament');
  return joinTournament(session.userId, params.slug);
});
