import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { grantChips, MAX_GRANT } from '@/server/admin/wallet';
import { adminCtx } from '@/server/http/admin';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ amount: z.int().min(1).max(MAX_GRANT), reason: reasonSchema }).strict();

/**
 * Owner-only grant of virtual test chips (no monetary value). The client sends
 * the amount and reason only; the resulting balance is computed on the server.
 */
export const POST = route<'ledger:grant', { userId: string }>({ name: 'admin.user.grant', auth: 'ledger:grant', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const key = idempotencyKeyFrom(ctx.req);
  const body = await readJson(ctx.req, schema);
  const res = await grantChips(adminCtx(ctx), z.uuid().parse(ctx.params.userId), body.amount, body.reason, key);
  return NextResponse.json(res.body, { status: res.status, headers: res.replayed ? { 'Idempotent-Replayed': 'true' } : {} });
});
