import { sandboxProvider } from './sandbox';
import type { PaymentProvider } from './types';

/** Registered payment providers. Only the sandbox simulator exists; adding a live provider is an operator decision (docs/payments.md). */
const PROVIDERS: Record<string, PaymentProvider> = { sandbox: sandboxProvider };

export function getProvider(id: string): PaymentProvider | null {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id]! : null;
}
