import { route } from '@/server/http/handler';
import { operationalHealth } from '@/server/observability/health';
import { metrics } from '@/server/observability/metrics';

export const GET = route({ name: 'admin.health', auth: 'system:read' }, async () => ({
  ...(await operationalHealth()),
  http: {
    requests: metrics.counterTotal('http_requests_total'),
    serverErrors: metrics.counterTotal('http_requests_total', (k) => /status="5\d\d"/.test(k)),
    clientErrors: metrics.counterTotal('http_requests_total', (k) => /status="4\d\d"/.test(k)),
    sinceProcessStart: new Date(metrics.startedAt).toISOString(),
  },
}));
