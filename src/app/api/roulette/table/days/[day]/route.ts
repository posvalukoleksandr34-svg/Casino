import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { tableDay } from '@/server/games/roulette-table';

/** A table day's seed commitment; the seed itself once the day has ended (for verification). */
export const GET = route<'public', { day: string }>({ name: 'roulette.table.day', auth: 'public', rateLimit: [RATE_LIMITS.tableIp] }, async ({ params }) => tableDay(params.day));
