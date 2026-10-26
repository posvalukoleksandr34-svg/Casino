import { adminGames } from '@/server/admin/admin-service';
import { route } from '@/server/http/handler';

export const GET = route({ name: 'admin.games', auth: 'admin:access' }, async () => ({ games: await adminGames() }));
