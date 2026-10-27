import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { setSportsFavorite } from '@/server/sports/queries';

type Params = { kind: string; refId: string };

export const PUT = route<'user', Params>({ name: 'sports.favorites.add', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => ({
  favorites: await setSportsFavorite(ctx.session.userId, ctx.params.kind, decodeURIComponent(ctx.params.refId), true),
}));

export const DELETE = route<'user', Params>({ name: 'sports.favorites.remove', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => ({
  favorites: await setSportsFavorite(ctx.session.userId, ctx.params.kind, decodeURIComponent(ctx.params.refId), false),
}));
