import { z } from 'zod';
import { reasonSchema } from '@/server/admin/admin-service';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { adminSetMarketWindow, sportsEventAdminDetail } from '@/server/sports/admin';
import { adminCorrectResult, adminSuspendEvent, adminVoidEvent } from '@/server/sports/queries';

const isoOrNull = z.iso.datetime({ offset: true }).nullable();

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('result'), home: z.int().min(0).max(99), away: z.int().min(0).max(99), reason: reasonSchema }).strict(),
  z.object({ action: z.literal('void'), reason: reasonSchema }).strict(),
  z.object({ action: z.literal('suspend'), reason: reasonSchema }).strict(),
  z.object({ action: z.literal('resume'), reason: reasonSchema }).strict(),
  z.object({ action: z.literal('window'), opensAt: isoOrNull, closesAt: isoOrNull, reason: reasonSchema }).strict(),
]);

/** Event detail for staff: tickets by selection, result versions, settlement history, audit trail. */
export const GET = route<'admin:access', { eventId: string }>({ name: 'admin.sports.event.detail', auth: 'admin:access', rateLimit: [RATE_LIMITS.adminUser] }, async (ctx) =>
  sportsEventAdminDetail(ctx.params.eventId),
);

/**
 * Operator actions on a sports event; every change is audited with its reason.
 * Results are scores entered by staff (never a client-chosen winner or payout);
 * corrections only ever credit players.
 */
export const POST = route<'sports:manage', { eventId: string }>(
  { name: 'admin.sports.event', auth: 'sports:manage', rateLimit: [RATE_LIMITS.adminUser] },
  async (ctx) => {
    const eventId = z.uuid().parse(ctx.params.eventId);
    const body = await readJson(ctx.req, schema);
    const actor = { adminId: ctx.session.userId, ipHash: ctx.ipHash, requestId: ctx.requestId };
    switch (body.action) {
      case 'result':
        return adminCorrectResult(actor, eventId, body.home, body.away, body.reason);
      case 'void':
        return adminVoidEvent(actor, eventId, body.reason);
      case 'suspend':
      case 'resume':
        return adminSuspendEvent(actor, eventId, body.action === 'suspend', body.reason);
      case 'window':
        return adminSetMarketWindow(actor, eventId, { opensAt: body.opensAt ? new Date(body.opensAt) : null, closesAt: body.closesAt ? new Date(body.closesAt) : null }, body.reason);
    }
  },
);
