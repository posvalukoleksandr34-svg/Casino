import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { tableState } from '@/server/games/roulette-table';

/** The automatic roulette table: schedule, current slot, seed commitments and recent public table spins. */
export const GET = route({ name: 'roulette.table', auth: 'public', rateLimit: [RATE_LIMITS.tableIp] }, async () => tableState());
