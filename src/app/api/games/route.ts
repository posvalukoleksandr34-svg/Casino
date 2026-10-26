import { route } from '@/server/http/handler';
import { listGames } from '@/server/games/lobby';

export const GET = route({ name: 'games.list', auth: 'public' }, async () => ({ games: await listGames() }));
