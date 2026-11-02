import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SandboxCheckoutActions } from '@/components/cashier/cashier-actions';
import { formatChips } from '@/engine/money';
import { requireUser } from '@/server/auth/current';
import { AppError } from '@/server/errors';
import { paymentsMode, platformCurrency } from '@/server/payments/config';
import { getDeposit } from '@/server/payments/deposits';

export const metadata = { title: 'Sandbox checkout' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The sandbox provider's hosted checkout, simulated inside this application.
 * It deliberately looks like a separate service (a real provider's page is on
 * the provider's own site) and asks for no payment details.
 */
export default async function SandboxCheckoutPage({ params }: { params: Promise<{ depositId: string }> }) {
  const { depositId } = await params;
  const session = await requireUser(`/wallet/sandbox-checkout/${depositId}`);
  if (paymentsMode() !== 'sandbox' || !UUID.test(depositId)) notFound();
  const d = await getDeposit(session.userId, depositId).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  if (!d.sandbox) notFound();
  const unit = platformCurrency().label;
  const open = d.status === 'PENDING' && new Date(d.expiresAt) > new Date();
  return (
    <div className="mx-auto max-w-lg py-6">
      <div className="overflow-hidden rounded-2xl bg-white text-[#101828] shadow-2xl" data-testid="sandbox-checkout">
        <div className="bg-[repeating-linear-gradient(135deg,#fde68a_0_12px,#fcd34d_12px_24px)] px-5 py-2 text-center text-xs font-bold uppercase tracking-[0.2em] text-[#78350f]">
          Test mode — simulated payment, no real money
        </div>
        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold tracking-tight">Sandbox Pay</span>
            <span className="rounded-full bg-[#f2f4f7] px-2.5 py-1 text-xs font-medium text-[#475467]">Simulator</span>
          </div>
          <div>
            <div className="text-sm text-[#475467]">Pay Aurovane</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums" data-testid="sandbox-amount">
              {formatChips(d.amount)} <span className="text-base font-medium text-[#475467]">{unit}</span>
            </div>
            <div className="mt-1 text-xs text-[#667085]">
              {d.method} · reference <span className="font-mono">{d.reference}</span>
            </div>
          </div>
          <div className="rounded-xl bg-[#f9fafb] p-4 text-sm leading-relaxed text-[#344054]">
            This simulator stands in for a payment provider. A real provider would collect payment details on its own site; Aurovane never sees or stores card numbers. Choose an
            outcome: the simulator then sends a signed confirmation to Aurovane&apos;s server, which decides what happens to your balance.
          </div>
          {open ? (
            <SandboxCheckoutActions depositId={d.id} />
          ) : (
            <p className="text-sm text-[#475467]">
              This checkout is no longer open ({d.status.toLowerCase().replace('_', ' ')}).{' '}
              <Link href={`/wallet/deposits/${d.id}`} className="font-medium text-[#1f6f4a] underline">
                See the deposit
              </Link>
            </p>
          )}
          <div className="text-xs text-[#667085]">Expires {new Date(d.expiresAt).toLocaleTimeString()}</div>
        </div>
      </div>
    </div>
  );
}
