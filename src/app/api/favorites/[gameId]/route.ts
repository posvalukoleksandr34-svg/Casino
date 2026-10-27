import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { addFavorite, removeFavorite } from '@/server/games/favorites';

type Params = { gameId: string };

export const PUT = route<'user', Params>({ name: 'favorites.add', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => ({
  favorites: await addFavorite(ctx.session.userId, ctx.params.gameId),
}));

export const DELETE = route<'user', Params>({ name: 'favorites.remove', auth: 'user', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => ({
  favorites: await removeFavorite(ctx.session.userId, ctx.params.gameId),
}));
