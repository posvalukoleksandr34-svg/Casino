import { z } from 'zod';
import { dailySeries, exposureByGame, platformSummary } from '@/server/analytics/analytics';
import { parseQuery, route } from '@/server/http/handler';

const query = z.object({ days: z.coerce.number().int().min(1).max(3650).optional(), series: z.coerce.number().int().min(1).max(365).default(30) });

export const GET = route({ name: 'admin.analytics', auth: 'analytics:read' }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  const from = q.days ? new Date(Date.now() - q.days * 86400_000) : undefined;
  return {
    period: { from: from?.toISOString() ?? null, to: new Date().toISOString() },
    summary: await platformSummary({ from }),
    series: await dailySeries(q.series),
    exposure: await exposureByGame(),
    note: 'All figures are computed from recorded rounds. Theoretical values use the documented rules; no simulated data is included.',
  };
});
