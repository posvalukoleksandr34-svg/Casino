import { NextResponse } from 'next/server';
import { z } from 'zod';
import { idempotencyKeyFrom, readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { startRound } from '@/server/games/round-service';

/**
 * Places a wager and starts a round. The request carries only the player's
 * choices (stake and selections); the outcome is produced server-side.
 * Requires an Idempotency-Key header: retries with the same key return the
 * original result and never charge twice.
 */
export const POST = route<'user', { gameId: string }>(
  { name: 'rounds.start', auth: 'user', rateLimit: [RATE_LIMITS.betUser] },
  async (ctx) => {
    const key = idempotencyKeyFrom(ctx.req);
    const body = await readJson(ctx.req, z.object({ bet: z.unknown() }).strict());
    const res = await startRound({
      userId: ctx.session.userId,
      gameId: ctx.params.gameId,
      bet: body.bet,
      idempotencyKey: key,
      sessionStartedAt: ctx.session.sessionCreatedAt,
    });
    return NextResponse.json(res.body, { status: res.status, headers: res.replayed ? { 'Idempotent-Replayed': 'true' } : {} });
  },
);
