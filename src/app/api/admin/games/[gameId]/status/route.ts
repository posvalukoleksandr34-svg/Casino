import { z } from 'zod';
import { reasonSchema, setGameStatus } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']), reason: reasonSchema, confirmOpenRounds: z.boolean().optional() }).strict();

export const POST = route<'games:manage', { gameId: string }>({ name: 'admin.game.status', auth: 'games:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return setGameStatus(adminCtx(ctx), ctx.params.gameId, body.status, body.reason, { confirmOpenRounds: body.confirmOpenRounds });
});
