/**
 * Payment webhooks: the only way money enters or leaves a wallet through the
 * cashier. Each delivery is
 *
 *   1. verified by the provider adapter (signature over the raw body, and a
 *      timestamp no older than the tolerance window);
 *   2. de-duplicated by the provider's event id (an advisory lock, then the
 *      payment_events unique index), so a replayed or retried event is applied
 *      once;
 *   3. applied in one transaction with the ledger posting and the event log
 *      row, so a crash leaves either everything or nothing.
 *
 * Deliveries that fail verification are logged (signature_valid = false) and
 * never touch a deposit or withdrawal.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb, withTransaction } from '../db/client';
import { paymentEvents } from '../db/schema';
import { logger } from '../observability/logger';
import { metrics } from '../observability/metrics';
import { paymentsMode } from './config';
import { applyDepositEvent } from './deposits';
import { getProvider } from './providers';
import { WebhookRejected, type ProviderEvent } from './providers/types';
import { applyPayoutEvent } from './withdrawals';

export type WebhookOutcome =
  | { status: 200; body: { received: true; duplicate: boolean; result: string } }
  | { status: 400 | 404 | 503; body: { received: false; error: string } };

function preview(rawBody: string) {
  // Enough to investigate a rejected delivery; never the whole body.
  return { bytes: Buffer.byteLength(rawBody), preview: rawBody.slice(0, 500) };
}

export async function handleWebhook(providerId: string, rawBody: string, headers: Headers, now = new Date()): Promise<WebhookOutcome> {
  const provider = getProvider(providerId);
  if (!provider) return { status: 404, body: { received: false, error: 'unknown provider' } };
  if (paymentsMode() === 'disabled') return { status: 503, body: { received: false, error: 'payments are disabled' } };

  let event: ProviderEvent;
  try {
    event = provider.verifyWebhook(rawBody, headers, now);
  } catch (err) {
    if (!(err instanceof WebhookRejected)) throw err;
    metrics.inc('casino_payment_webhooks_total', { provider: providerId, outcome: 'rejected' });
    logger.warn('payment webhook rejected', { provider: providerId, reason: err.message });
    await getDb()
      .insert(paymentEvents)
      .values({ provider: providerId, eventId: null, eventType: null, signatureValid: false, payload: preview(rawBody), result: `rejected: ${err.message}`, receivedAt: now });
    return { status: 400, body: { received: false, error: err.message } };
  }

  const outcome = await withTransaction(async (tx) => {
    // Serialise deliveries of the same event, then check whether it was applied.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-event:${providerId}:${event.id}`}, 0))`);
    const [seen] = await tx
      .select({ result: paymentEvents.result })
      .from(paymentEvents)
      .where(and(eq(paymentEvents.provider, providerId), eq(paymentEvents.eventId, event.id), eq(paymentEvents.signatureValid, true)));
    if (seen) return { duplicate: true, result: seen.result };

    let result: string;
    let depositId: string | null = null;
    let withdrawalId: string | null = null;
    if (event.type.startsWith('deposit.')) ({ result, depositId } = await applyDepositEvent(tx, providerId, event, now));
    else ({ result, withdrawalId } = await applyPayoutEvent(tx, providerId, event, now));

    await tx.insert(paymentEvents).values({
      provider: providerId,
      eventId: event.id,
      eventType: event.type,
      signatureValid: true,
      payload: { ...event },
      result,
      depositId,
      withdrawalId,
      receivedAt: now,
    });
    return { duplicate: false, result };
  });
  metrics.inc('casino_payment_webhooks_total', { provider: providerId, outcome: outcome.duplicate ? 'duplicate' : 'applied' });
  return { status: 200, body: { received: true, ...outcome } };
}
