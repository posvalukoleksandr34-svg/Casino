/**
 * Test controls for the sandbox provider. They play the provider's part, not
 * the cashier's: each one makes the simulated provider send a signed webhook,
 * which then goes through exactly the same verification, de-duplication and
 * ledger code as a real provider's would. Nothing here credits or debits a
 * wallet directly, and none of it exists outside sandbox mode.
 */
import { and, eq, lte } from 'drizzle-orm';
import { recordAdminAction } from '../audit/audit';
import type { AdminCtx } from '../admin/admin-service';
import { getDb, withTransaction } from '../db/client';
import { deposits, withdrawals } from '../db/schema';
import { errors } from '../errors';
import { paymentsMode } from './config';
import { sandboxDelivery } from './providers/sandbox';
import { handleWebhook } from './webhooks';

function assertSandbox() {
  if (paymentsMode() !== 'sandbox') throw errors.notFound('Sandbox');
}

export type CheckoutOutcome = 'pay' | 'decline' | 'cancel';

/** The simulated checkout page: the player "pays", declines or abandons a sandbox deposit. */
export async function sandboxCheckout(userId: string, depositId: string, outcome: CheckoutOutcome, now = new Date()) {
  assertSandbox();
  const [d] = await getDb().select().from(deposits).where(and(eq(deposits.id, depositId), eq(deposits.userId, userId)));
  if (!d || d.provider !== 'sandbox' || !d.providerReference) throw errors.notFound('Deposit');
  if (d.status !== 'PENDING') throw errors.conflict(`This deposit is ${d.status.toLowerCase().replace('_', ' ')}.`);
  if (d.expiresAt <= now) throw errors.conflict('This checkout has expired. Start a new deposit.');
  const type = outcome === 'pay' ? 'deposit.completed' : outcome === 'decline' ? 'deposit.failed' : 'deposit.cancelled';
  const reason = outcome === 'decline' ? 'Declined by the test card issuer (simulated).' : outcome === 'cancel' ? 'You cancelled the payment.' : undefined;
  const delivery = sandboxDelivery({ type, reference: d.providerReference, amount: d.amount, currency: d.currency, reason }, now);
  const res = await handleWebhook('sandbox', delivery.body, delivery.headers, now);
  if (res.status !== 200) throw errors.conflict(`The simulated provider's notification was not accepted: ${res.body.error}`);
  return { result: res.body.result };
}

/** Staff test control: the simulated provider reports a payout as paid or failed. */
export async function sandboxSettlePayout(ctx: AdminCtx, withdrawalId: string, outcome: 'paid' | 'failed', now = new Date()) {
  assertSandbox();
  const [w] = await getDb().select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
  if (!w || w.provider !== 'sandbox' || !w.providerReference) throw errors.notFound('Withdrawal');
  if (w.status !== 'PROCESSING') throw errors.conflict(`This withdrawal is ${w.status.toLowerCase().replace('_', ' ')}; only a payout in progress can be settled.`);
  const delivery = sandboxDelivery(
    { type: outcome === 'paid' ? 'payout.completed' : 'payout.failed', reference: w.providerReference, amount: w.payout, currency: w.currency, reason: outcome === 'failed' ? 'The receiving account rejected the transfer (simulated).' : undefined },
    now,
  );
  const res = await handleWebhook('sandbox', delivery.body, delivery.headers, now);
  if (res.status !== 200) throw errors.conflict(`The simulated provider's notification was not accepted: ${res.body.error}`);
  await withTransaction(async (tx) => {
    await recordAdminAction(tx, { ...ctx, action: 'payment.sandbox_payout_settled', targetType: 'withdrawal', targetId: w.id, reason: `Sandbox test: payout ${outcome}`, after: { result: res.body.result } });
  });
  return { result: res.body.result };
}

/**
 * Scheduler job (sandbox only): the simulated provider completes payouts that
 * have been in progress for at least `afterMs`, as a bank would after a delay.
 */
export async function settleSandboxPayouts(now = new Date(), afterMs = 60_000, limit = 50): Promise<number> {
  if (paymentsMode() !== 'sandbox') return 0;
  const due = await getDb()
    .select()
    .from(withdrawals)
    .where(and(eq(withdrawals.status, 'PROCESSING'), eq(withdrawals.provider, 'sandbox'), lte(withdrawals.updatedAt, new Date(now.getTime() - afterMs))))
    .limit(limit);
  let n = 0;
  for (const w of due) {
    if (!w.providerReference) continue;
    const delivery = sandboxDelivery({ type: 'payout.completed', reference: w.providerReference, amount: w.payout, currency: w.currency }, now);
    const res = await handleWebhook('sandbox', delivery.body, delivery.headers, now);
    if (res.status === 200 && res.body.result === 'completed') n++;
  }
  return n;
}
