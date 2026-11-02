import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { tournamentDetail } from '@/server/tournaments/tournaments';

export const GET = route<'optional', { slug: string }>({ name: 'tournaments.get', auth: 'optional', rateLimit: [RATE_LIMITS.tableIp] }, async ({ params, session }) => {
  if (!/^[a-z0-9-]{3,40}$/.test(params.slug)) throw errors.notFound('Tournament');
  return tournamentDetail(params.slug, session?.userId ?? null);
});
