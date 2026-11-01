import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { requestApproval } from '@/server/admin/approvals';
import { adminCtx } from '@/server/http/admin';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z
  .object({ amount: z.int().refine((v) => v !== 0, 'Amount must be non-zero'), reason: reasonSchema, reversesTransactionId: z.int().positive().optional() })
  .strict();

/**
 * Requests a compensating balance correction (ledger:adjust). Corrections are
 * four-eyes: this creates a pending approval request (202); a second staff
 * member with ledger:adjust executes it from /admin/approvals. Idempotent per
 * Idempotency-Key.
 */
export const POST = route<'ledger:adjust', { userId: string }>({ name: 'admin.user.adjust', auth: 'ledger:adjust', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const key = idempotencyKeyFrom(ctx.req);
  const body = await readJson(ctx.req, schema);
  const res = await requestApproval(
    adminCtx(ctx),
    { action: 'ledger.adjustment', targetId: z.uuid().parse(ctx.params.userId), params: { amount: body.amount, ...(body.reversesTransactionId ? { reversesTransactionId: body.reversesTransactionId } : {}) }, reason: body.reason },
    key,
  );
  return NextResponse.json({ approvalRequired: true, ...res.body }, { status: res.status, headers: res.replayed ? { 'Idempotent-Replayed': 'true' } : {} });
});
