import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { setStaffMfaRequired, staffMfaOverview } from '@/server/auth/mfa';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

/** Staff accounts and their MFA status. */
export const GET = route({ name: 'admin.security', auth: 'security:manage', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ staff: await staffMfaOverview() }));

const schema = z.object({ staffMfaRequired: z.boolean(), reason: reasonSchema }).strict();

/** Owner-only: require two-factor authentication for every staff session. */
export const POST = route({ name: 'admin.security.update', auth: 'security:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  return setStaffMfaRequired(ctx.session, body.staffMfaRequired, body.reason, { ipHash: ctx.ipHash, requestId: ctx.requestId });
});
