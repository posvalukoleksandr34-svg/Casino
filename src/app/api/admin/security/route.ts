import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { setStaffMfaRequired, staffMfaOverview } from '@/server/auth/mfa';
import { NextResponse } from 'next/server';
import { requestApproval } from '@/server/admin/approvals';
import { adminCtx } from '@/server/http/admin';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

/** Staff accounts and their MFA status. */
export const GET = route({ name: 'admin.security', auth: 'security:manage', rateLimit: [RATE_LIMITS.adminUser] }, async () => ({ staff: await staffMfaOverview() }));

const schema = z.object({ staffMfaRequired: z.boolean(), reason: reasonSchema }).strict();

/**
 * Owner-only staff MFA policy. Turning it on is immediate; turning it off
 * weakens security and needs a second owner: it creates an approval request
 * (202, Idempotency-Key required).
 */
export const POST = route({ name: 'admin.security.update', auth: 'security:manage', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const body = await readJson(ctx.req, schema);
  if (body.staffMfaRequired) return setStaffMfaRequired(ctx.session, true, body.reason, { ipHash: ctx.ipHash, requestId: ctx.requestId });
  const res = await requestApproval(adminCtx(ctx), { action: 'security.staff_mfa_disable', params: {}, reason: body.reason }, idempotencyKeyFrom(ctx.req));
  return NextResponse.json({ approvalRequired: true, ...res.body }, { status: res.status, headers: res.replayed ? { 'Idempotent-Replayed': 'true' } : {} });
});
