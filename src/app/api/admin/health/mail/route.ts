import { z } from 'zod';
import { audit } from '@/server/audit/audit';
import { getDb } from '@/server/db/client';
import { readJson, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { mailStatus, sendNow, verifyMailTransport } from '@/server/mail/mailer';
import { testEmail } from '@/server/mail/templates';

const schema = z.object({ action: z.enum(['verify', 'test']) }).strict();

/**
 * Operator check of e-mail delivery: `verify` connects and authenticates to the
 * SMTP server without sending; `test` also sends a test message to the
 * operator's own address (never to an address from the request). Audited.
 */
export const POST = route({ name: 'admin.health.mail', auth: 'system:operate', rateLimit: [RATE_LIMITS.mutateUser] }, async (ctx) => {
  const { action } = await readJson(ctx.req, schema);
  const verified = await verifyMailTransport();
  let sent: boolean | null = null;
  let failure: string | null = null;
  if (action === 'test' && verified.ok) {
    const res = await sendNow(testEmail(ctx.session.email), { purpose: 'operator_test', userId: ctx.session.userId });
    sent = res.ok;
    failure = res.ok ? null : res.failure.reason;
  }
  await audit(getDb(), {
    actorId: ctx.session.userId,
    actorType: 'ADMIN',
    action: action === 'test' ? 'mail.test_sent' : 'mail.verified',
    resourceType: 'platform',
    resourceId: 'mail',
    outcome: verified.ok && sent !== false ? 'SUCCESS' : 'FAILED',
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
    metadata: { transport: verified.transport },
  });
  return { verified, sent, failure, status: mailStatus() };
});
