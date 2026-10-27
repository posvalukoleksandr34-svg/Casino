import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idempotencyKeyFrom, parseQuery, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { listTickets, placeSlip } from '@/server/sports/tickets';

/**
 * Places a slip of single predictions. The body carries selections, stakes and
 * the odds the player saw (only used to detect a price change); prices and
 * results are the server's. Requires an Idempotency-Key header.
 */
export const POST = route({ name: 'sports.tickets.place', auth: 'user', rateLimit: [RATE_LIMITS.betUser] }, async (ctx) => {
  const key = idempotencyKeyFrom(ctx.req);
  const body = await readJson(ctx.req, z.unknown());
  const res = await placeSlip({ userId: ctx.session.userId, idempotencyKey: key, slip: body, sessionStartedAt: ctx.session.sessionCreatedAt });
  return NextResponse.json(res.body, { status: res.status, headers: res.replayed ? { 'Idempotent-Replayed': 'true' } : {} });
});

const query = z.object({
  status: z.enum(['open', 'settled', 'all']).default('all'),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = route({ name: 'sports.tickets.list', auth: 'user', rateLimit: [RATE_LIMITS.readUser] }, async (ctx) => {
  const q = parseQuery(ctx.req, query);
  const items = await listTickets(ctx.session.userId, { status: q.status, before: q.before ? new Date(q.before) : undefined, limit: q.limit });
  return { items, nextCursor: items.length === q.limit ? items.at(-1)!.placedAt : null };
});
