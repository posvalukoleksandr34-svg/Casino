import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyEmailForm } from '@/components/auth/verify-email-form';
import { currentSession } from '@/server/auth/current';
import { flowCookieName, readFlowToken, signupStatus } from '@/server/users/verification';

export const metadata = { title: 'Verify your e-mail' };

/** Step 2. The pending account comes only from this browser's signed signup-flow cookie. */
export default async function VerifyEmailPage() {
  const session = await currentSession();
  if (session) redirect(session.onboardingPending ? '/onboarding' : '/lobby');
  const userId = readFlowToken((await cookies()).get(flowCookieName())?.value);
  const status = userId ? await signupStatus(userId) : null;
  if (!status) {
    return (
      <AuthShell step={2} title="Verify your e-mail" subtitle="There is no registration waiting to be verified in this browser.">
        <div className="space-y-4 text-sm text-ink-300">
          <p>If you already created an account, sign in with your e-mail and password: we will send a new code if you still need one.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/login" className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-gradient-to-b from-gold-400 to-gold-600 font-semibold text-ink-950">
              Sign in
            </Link>
            <Link href="/register" className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-ink-600 text-ink-200 hover:border-gold-600">
              Create an account
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell step={2} title="Check your inbox" subtitle="Enter the six-digit code we sent to confirm your e-mail address.">
      <VerifyEmailForm initial={status} />
    </AuthShell>
  );
}
