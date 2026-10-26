import { errors } from '@/server/errors';
import { route } from '@/server/http/handler';
import { getGameSummary } from '@/server/games/lobby';

export const GET = route<'public', { gameId: string }>({ name: 'games.get', auth: 'public' }, async ({ params }) => {
  const game = await getGameSummary(params.gameId);
  if (!game || game.status === 'DISABLED') throw errors.notFound('Game');
  return { game };
});
