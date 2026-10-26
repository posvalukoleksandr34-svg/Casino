import { z } from 'zod';
import { reasonSchema, setGameStatus } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']), reason: reasonSchema }).strict();

export const POST = route<'games:manage', { gameId: string }>({ name: 'admin.game.status', auth: 'games:manage' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return setGameStatus(adminCtx(ctx), ctx.params.gameId, body.status, body.reason);
});
