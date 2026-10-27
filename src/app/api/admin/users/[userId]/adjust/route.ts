import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { adjustBalance } from '@/server/admin/wallet';
import { adminCtx } from '@/server/http/admin';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z
  .object({ amount: z.int().refine((v) => v !== 0, 'Amount must be non-zero'), reason: reasonSchema, reversesTransactionId: z.int().positive().optional() })
  .strict();

/** Compensating balance correction (ledger:adjust; visible to the player, audited, idempotent per Idempotency-Key). */
export const POST = route<'ledger:adjust', { userId: string }>({ name: 'admin.user.adjust', auth: 'ledger:adjust', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const key = idempotencyKeyFrom(ctx.req);
  const body = await readJson(ctx.req, schema);
  const res = await adjustBalance(adminCtx(ctx), z.uuid().parse(ctx.params.userId), body.amount, body.reason, key, body.reversesTransactionId);
  return NextResponse.json(res.body, { status: res.status, headers: res.replayed ? { 'Idempotent-Replayed': 'true' } : {} });
});
