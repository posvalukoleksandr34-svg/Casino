import { z } from 'zod';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { getRoundForUser } from '@/server/games/round-service';

export const GET = route<'user', { roundId: string }>({ name: 'rounds.get', auth: 'user' }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.roundId).success) throw errors.notFound('Round');
  const { userId: _owner, ...round } = await getRoundForUser(session.userId, params.roundId);
  return { round };
});
