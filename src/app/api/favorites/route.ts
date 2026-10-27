import { route } from '@/server/http/handler';
import { listFavorites, recentlyPlayed } from '@/server/games/favorites';

export const GET = route({ name: 'favorites.list', auth: 'user' }, async (ctx) => ({
  favorites: await listFavorites(ctx.session.userId),
  recent: await recentlyPlayed(ctx.session.userId),
}));
