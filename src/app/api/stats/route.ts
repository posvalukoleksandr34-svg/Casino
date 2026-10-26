import { route } from '@/server/http/handler';
import { playerStats } from '@/server/users/stats';

export const GET = route({ name: 'stats.player', auth: 'user' }, async ({ session }) => playerStats(session.userId));
