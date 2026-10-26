import { audit } from '@/server/audit/audit';
import { listReconciliations } from '@/server/admin/admin-service';
import { getDb } from '@/server/db/client';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { runReconciliation } from '@/server/jobs/reconciliation';

export const GET = route({ name: 'admin.reconciliation', auth: 'system:read', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ runs: await listReconciliations() }));

export const POST = route({ name: 'admin.reconciliation.run', auth: 'system:operate', rateLimit: [RATE_LIMITS.reconcileRun] }, async (ctx) => {
  const result = await runReconciliation(`admin:${ctx.session.userId}`);
  await audit(getDb(), { actorId: ctx.session.userId, actorType: 'ADMIN', action: 'reconciliation.run', resourceType: 'reconciliation', resourceId: String(result.id), requestId: ctx.requestId });
  return result;
});
