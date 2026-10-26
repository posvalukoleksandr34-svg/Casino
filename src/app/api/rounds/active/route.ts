import { route } from '@/server/http/handler';
import { openRounds } from '@/server/games/round-service';

/** Unfinished rounds for recovery after a reload or dropped connection. */
export const GET = route({ name: 'rounds.active', auth: 'user' }, async ({ session }) => ({ rounds: await openRounds(session.userId) }));
