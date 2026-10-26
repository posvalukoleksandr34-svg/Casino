import { route } from '@/server/http/handler';
import { userActivity } from '@/server/users/accounts';

export const GET = route({ name: 'account.activity', auth: 'user' }, async (ctx) => ({ activity: await userActivity(ctx.session.userId, 100) }));
