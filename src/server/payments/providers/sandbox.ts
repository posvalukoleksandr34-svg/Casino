/**
 * The sandbox payment provider: a simulator for end-to-end testing of the
 * cashier. NO MONEY MOVES. Deposits are "paid" on a simulated checkout page
 * inside this application; payouts are "sent" when a tester settles them.
 * Both send webhooks that are signed and verified exactly like a real
 * provider's would be:
 *
 *   header  Aurovane-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * Deliveries older than five minutes are rejected (replay protection) and an
 * event id is applied once (payment_events).
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../env';
import { sandboxSecret } from '../config';
import { WebhookRejected, type PaymentProvider, type ProviderEvent } from './types';

export const SIGNATURE_HEADER = 'aurovane-signature';
export const TOLERANCE_SECONDS = 300;

export function signSandbox(rawBody: string, t: number, secret = sandboxSecret()): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

/** Builds a signed delivery as the sandbox provider would send it. */
export function sandboxDelivery(event: Omit<ProviderEvent, 'id'> & { id?: string }, now = new Date()) {
  const body = JSON.stringify({ ...event, id: event.id ?? `evt_${randomUUID()}` });
  const headers = new Headers({ 'content-type': 'application/json', [SIGNATURE_HEADER]: signSandbox(body, Math.floor(now.getTime() / 1000)) });
  return { body, headers };
}

const TYPES = new Set<ProviderEvent['type']>(['deposit.completed', 'deposit.failed', 'deposit.cancelled', 'payout.completed', 'payout.failed']);

export const sandboxProvider: PaymentProvider = {
  id: 'sandbox',
  sandbox: true,

  async startDeposit(d) {
    const reference = `sbx_dep_${d.id}`;
    return { reference, redirectUrl: `${env().APP_URL.replace(/\/$/, '')}/wallet/sandbox-checkout/${d.id}` };
  },

  async startPayout(w) {
    return { reference: `sbx_pay_${w.id}` };
  },

  verifyWebhook(rawBody, headers, now) {
    const header = headers.get(SIGNATURE_HEADER) ?? '';
    const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header);
    if (!m) throw new WebhookRejected('missing or malformed signature');
    const t = Number(m[1]);
    if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_SECONDS) throw new WebhookRejected('stale signature timestamp');
    const expected = Buffer.from(signSandbox(rawBody, t).slice(-64), 'hex');
    const given = Buffer.from(m[2]!, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new WebhookRejected('signature mismatch');
    let e: Partial<ProviderEvent>;
    try {
      e = JSON.parse(rawBody) as Partial<ProviderEvent>;
    } catch {
      throw new WebhookRejected('body is not JSON');
    }
    if (typeof e.id !== 'string' || !/^evt_[A-Za-z0-9-]{8,64}$/.test(e.id)) throw new WebhookRejected('bad event id');
    if (!e.type || !TYPES.has(e.type)) throw new WebhookRejected('unknown event type');
    if (typeof e.reference !== 'string' || e.reference.length > 100) throw new WebhookRejected('bad reference');
    if (!Number.isSafeInteger(e.amount) || (e.amount as number) <= 0) throw new WebhookRejected('bad amount');
    if (typeof e.currency !== 'string') throw new WebhookRejected('bad currency');
    return { id: e.id, type: e.type, reference: e.reference, amount: e.amount as number, currency: e.currency, reason: typeof e.reason === 'string' ? e.reason.slice(0, 200) : undefined };
  },
};
