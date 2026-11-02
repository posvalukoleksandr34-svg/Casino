/**
 * Cashier configuration: payment mode, currency, default methods and rules.
 *
 * Business rules live in the database (payment_methods, cashier_settings),
 * edited by staff with payments:configure and validated here; these values
 * are only the bootstrap defaults. Amounts are integer minor units.
 */
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '../env';
import type { Executor } from '../db/client';
import { cashierSettings, paymentMethods } from '../db/schema';
import { AppError } from '../errors';

export const CURRENCIES = {
  CHIP: { code: 'CHIP', label: 'credits', minorDigits: 2, real: false },
  EUR: { code: 'EUR', label: 'EUR', minorDigits: 2, real: true },
  CHF: { code: 'CHF', label: 'CHF', minorDigits: 2, real: true },
  USD: { code: 'USD', label: 'USD', minorDigits: 2, real: true },
  GBP: { code: 'GBP', label: 'GBP', minorDigits: 2, real: true },
} as const;
export type CurrencyCode = keyof typeof CURRENCIES;

export function platformCurrency() {
  return CURRENCIES[env().PLATFORM_CURRENCY];
}

/**
 * 'sandbox' (default outside production) or 'disabled' (default in
 * production). There is deliberately no live mode in this code base.
 */
export function paymentsMode(): 'sandbox' | 'disabled' {
  const e = env();
  return e.PAYMENTS_MODE ?? (e.NODE_ENV === 'production' ? 'disabled' : 'sandbox');
}

export function assertPaymentsEnabled(): void {
  if (paymentsMode() === 'disabled') throw new AppError('SERVICE_UNAVAILABLE', 'Payments are not available on this site.');
}

/** Webhook signing secret of the sandbox simulator (a fixed development default outside production). */
export function sandboxSecret(): string {
  const e = env();
  if (e.PAYMENTS_SANDBOX_SECRET) return e.PAYMENTS_SANDBOX_SECRET;
  if (e.NODE_ENV === 'production') throw new Error('PAYMENTS_SANDBOX_SECRET is required');
  return createHmac('sha256', 'aurovane-dev').update('payments-sandbox').digest('hex');
}

/** Fee for an amount: fixed + basis points, rounded down; never the whole amount. */
export function feeFor(amount: number, fixed: number, bp: number): number {
  return fixed + Math.floor((amount * bp) / 10_000);
}

export const DEFAULT_CASHIER_SETTINGS = {
  id: 1,
  dailyDepositLimit: 500_000,
  monthlyDepositLimit: 5_000_000,
  depositExpiryMinutes: 30,
  dailyWithdrawalLimit: 1_000_000,
  monthlyWithdrawalLimit: 10_000_000,
  withdrawalCooldownMinutes: 0,
  reviewThreshold: 100_000,
  dualApprovalThreshold: 500_000,
  kycRequiredForWithdrawal: true,
  closedLoop: true,
};

/** Sandbox methods seeded at bootstrap: a simulated provider, labelled as such everywhere. */
export const DEFAULT_PAYMENT_METHODS = [
  { id: 'sandbox-card', name: 'Test card (sandbox)', kind: 'CARD' as const, provider: 'sandbox', sandbox: true, minDeposit: 1_000, maxDeposit: 200_000, minWithdrawal: 2_000, maxWithdrawal: 500_000, depositFeeFixed: 0, depositFeeBp: 0, withdrawalFeeFixed: 0, withdrawalFeeBp: 0, processingTime: 'Instant (simulated)', sortOrder: 10 },
  { id: 'sandbox-bank', name: 'Test bank transfer (sandbox)', kind: 'BANK_TRANSFER' as const, provider: 'sandbox', sandbox: true, minDeposit: 2_000, maxDeposit: 500_000, minWithdrawal: 5_000, maxWithdrawal: 1_000_000, depositFeeFixed: 0, depositFeeBp: 0, withdrawalFeeFixed: 100, withdrawalFeeBp: 0, processingTime: '1–2 business days (simulated)', sortOrder: 20 },
  { id: 'sandbox-wallet', name: 'Test e-wallet (sandbox)', kind: 'E_WALLET' as const, provider: 'sandbox', sandbox: true, minDeposit: 1_000, maxDeposit: 100_000, minWithdrawal: 2_000, maxWithdrawal: 200_000, depositFeeFixed: 0, depositFeeBp: 150, withdrawalFeeFixed: 0, withdrawalFeeBp: 0, processingTime: 'Within hours (simulated)', sortOrder: 30 },
];

export async function ensureCashierDefaults(db: Executor): Promise<void> {
  await db.insert(cashierSettings).values(DEFAULT_CASHIER_SETTINGS).onConflictDoNothing({ target: cashierSettings.id });
  for (const m of DEFAULT_PAYMENT_METHODS) await db.insert(paymentMethods).values(m).onConflictDoNothing({ target: paymentMethods.id });
}

export async function getCashierSettings(db: Executor) {
  const [row] = await db.select().from(cashierSettings).where(eq(cashierSettings.id, 1));
  if (!row) throw new Error('cashier settings missing; run migrations and bootstrap');
  return row;
}
