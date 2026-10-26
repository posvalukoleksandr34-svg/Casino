import { z } from 'zod';
import { publishGameConfig, reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';

const schema = z.object({ config: z.unknown(), reason: reasonSchema }).strict();

export const POST = route<'games:manage', { gameId: string }>({ name: 'admin.game.config', auth: 'games:manage' }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return publishGameConfig(adminCtx(ctx), ctx.params.gameId, body.config, body.reason);
});
