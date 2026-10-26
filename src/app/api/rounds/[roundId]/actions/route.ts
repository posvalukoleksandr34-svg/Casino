import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errors } from '@/server/errors';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { actOnRound } from '@/server/games/round-service';

export const POST = route<'user', { roundId: string }>(
  { name: 'rounds.act', auth: 'user', rateLimit: [RATE_LIMITS.actionUser] },
  async (ctx) => {
    if (!z.uuid().safeParse(ctx.params.roundId).success) throw errors.notFound('Round');
    const key = idempotencyKeyFrom(ctx.req);
    const body = await readJson(ctx.req, z.object({ action: z.unknown() }).strict());
    const res = await actOnRound({
      userId: ctx.session.userId,
      roundId: ctx.params.roundId,
      action: body.action,
      idempotencyKey: key,
      sessionStartedAt: ctx.session.sessionCreatedAt,
    });
    return NextResponse.json(res.body, { status: res.status, headers: res.replayed ? { 'Idempotent-Replayed': 'true' } : {} });
  },
);
