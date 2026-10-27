import { route } from '@/server/http/handler';
import { sportsStats } from '@/server/sports/tickets';

export const GET = route({ name: 'sports.stats', auth: 'user' }, async ({ session }) => ({ stats: await sportsStats(session.userId) }));
