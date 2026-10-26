import { z } from 'zod';
import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { expireRoundIfDue, getRoundForUser } from '@/server/games/round-service';

export const GET = route<'user', { roundId: string }>({ name: 'rounds.get', auth: 'user' }, async ({ params, session }) => {
  if (!z.uuid().safeParse(params.roundId).success) throw errors.notFound('Round');
  let found = await getRoundForUser(session.userId, params.roundId);
  if (found.status === 'OPEN' && (await expireRoundIfDue(params.roundId))) {
    // Time-based outcome (e.g. a crash) already happened: settle lazily, then re-read.
    found = await getRoundForUser(session.userId, params.roundId);
  }
  const { userId: _owner, ...round } = found;
  return { round, serverTime: new Date().toISOString() };
});
