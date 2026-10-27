import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fundHouse, reasonSchema } from '@/server/admin/admin-service';
import { adminCtx } from '@/server/http/admin';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const schema = z.object({ amount: z.int().positive(), reason: reasonSchema }).strict();

/** Owner-only issuance of virtual chips into the house bankroll; idempotent per Idempotency-Key. */
export const POST = route({ name: 'admin.house.fund', auth: 'house:fund', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) => {
  const key = idempotencyKeyFrom(ctx.req);
  const body = await readJson(ctx.req, schema);
  const res = await fundHouse(adminCtx(ctx), body.amount, body.reason, key);
  return NextResponse.json(res.body, { status: res.status, headers: res.replayed ? { 'Idempotent-Replayed': 'true' } : {} });
});
