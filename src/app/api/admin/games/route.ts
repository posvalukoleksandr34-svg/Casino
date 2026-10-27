import { adminGames } from '@/server/admin/admin-service';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

export const GET = route({ name: 'admin.games', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ games: await adminGames() }));
