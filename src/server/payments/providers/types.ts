/**
 * A payment provider adapter. The cashier never talks to a provider any other
 * way, so an authorised provider can be added without touching the wallet:
 * implement this interface, register it in ./index.ts, and configure methods
 * that use it. The only implementation in this code base is the sandbox
 * simulator; there is no live provider.
 */
export interface DepositStart {
  /** The provider's id for this payment (stored as deposits.provider_reference). */
  reference: string;
  /** Where the player completes the payment. */
  redirectUrl: string;
}

export interface ProviderEvent {
  /** Unique per provider: a replayed event id is recognised and applied once. */
  id: string;
  type: 'deposit.completed' | 'deposit.failed' | 'deposit.cancelled' | 'payout.completed' | 'payout.failed';
  /** The provider reference of the deposit or payout. */
  reference: string;
  amount: number;
  currency: string;
  reason?: string;
}

export class WebhookRejected extends Error {}

export interface PaymentProvider {
  readonly id: string;
  /** True for simulators: nothing real is charged or paid. */
  readonly sandbox: boolean;
  startDeposit(d: { id: string; amount: number; currency: string; methodId: string }): Promise<DepositStart>;
  startPayout(w: { id: string; payout: number; currency: string; methodId: string }): Promise<{ reference: string }>;
  /** Verifies a delivery (signature, freshness) and returns its event; throws WebhookRejected otherwise. */
  verifyWebhook(rawBody: string, headers: Headers, now: Date): ProviderEvent;
}
