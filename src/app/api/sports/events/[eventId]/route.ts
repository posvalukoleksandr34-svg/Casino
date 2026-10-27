import { route } from '@/server/http/handler';
import { getEvent } from '@/server/sports/queries';

export const GET = route<'optional', { eventId: string }>({ name: 'sports.event', auth: 'optional' }, async ({ params }) => ({
  event: await getEvent(params.eventId),
  serverTime: new Date().toISOString(),
}));
