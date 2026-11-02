import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listTournaments } from '@/server/tournaments/tournaments';

export const GET = route({ name: 'tournaments.list', auth: 'public', rateLimit: [RATE_LIMITS.tableIp] }, async () => ({ tournaments: await listTournaments() }));
