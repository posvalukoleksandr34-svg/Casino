import { z } from 'zod';
import { errors } from '@/server/errors';
import { getRoundForUser } from '@/server/games/round-service';
import { route } from '@/server/http/handler';

/** Staff view of a round. Hidden state (e.g. mine positions) stays hidden until the round is finished. */
export const GET = route<'rounds:read', { roundId: string }>({ name: 'admin.round', auth: 'rounds:read' }, async ({ params }) => {
  if (!z.uuid().safeParse(params.roundId).success) throw errors.notFound('Round');
  return { round: await getRoundForUser(null, params.roundId) };
});
