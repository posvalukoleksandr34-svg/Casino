import { NextResponse } from 'next/server';
import { errors } from '@/server/errors';
import { MAX_BODY_BYTES, route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { handleWebhook } from '@/server/payments/webhooks';

/**
 * Payment provider webhooks. Public and server-to-server: authenticated by
 * the provider's signature over the raw body, not by a session (see
 * server/payments/webhooks.ts). A 200 means "received; do not retry".
 */
export const POST = route<'public', { provider: string }>({ name: 'payments.webhook', auth: 'public', origin: 'signed', rateLimit: [RATE_LIMITS.webhookIp] }, async ({ req, params }) => {
  if (!/^[a-z0-9-]{2,30}$/.test(params.provider)) throw errors.notFound('Provider');
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) throw errors.validation('Request body too large');
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw errors.validation('Request body too large');
  const res = await handleWebhook(params.provider, raw, req.headers);
  return NextResponse.json(res.body, { status: res.status });
});
