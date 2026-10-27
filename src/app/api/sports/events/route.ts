import { route } from '@/server/http/handler';
import { listEvents, listSportsFavorites } from '@/server/sports/queries';
import { sportsConfig } from '@/server/sports/config';

/** Upcoming events with 1X2 prices and recent results, for the configured data mode. */
export const GET = route({ name: 'sports.events', auth: 'optional' }, async ({ session }) => {
  const cfg = sportsConfig();
  const events = await listEvents();
  return {
    mode: cfg.misconfigured ? 'unavailable' : cfg.mode,
    ...events,
    favorites: session ? await listSportsFavorites(session.userId) : null,
    serverTime: new Date().toISOString(),
  };
});
