import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { cancelTournament } from '@/server/tournaments/tournaments';

const schema = z.object({ reason: reasonSchema }).strict();

/** Cancels a tournament that has not been finalised: no prizes are paid; entrants are told why. */
export const POST = route<'promotions:manage', { id: string }>({ name: 'admin.tournaments.cancel', auth: 'promotions:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const id = z.coerce.number().int().positive().parse(ctx.params.id);
  const { reason } = await readJson(ctx.req, schema);
  return { tournament: await cancelTournament(adminCtx(ctx), id, reason) };
});
