import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { createTournament, listTournaments, tournamentCreateSchema } from '@/server/tournaments/tournaments';

export const GET = route({ name: 'admin.tournaments.list', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ tournaments: await listTournaments() }));

const schema = z.object({ tournament: tournamentCreateSchema, reason: reasonSchema }).strict();

export const POST = route({ name: 'admin.tournaments.create', auth: 'promotions:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return { tournament: await createTournament(adminCtx(ctx), body.tournament, body.reason) };
});
