import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';
import { currentSession } from '@/server/auth/current';

export const metadata = { title: 'Create account' };

export default async function RegisterPage() {
  const session = await currentSession();
  if (session) redirect(session.onboardingPending ? '/onboarding' : '/lobby');
  return (
    <AuthShell
      step={1}
      title="Create your account"
      subtitle="Free virtual chips only. No payment details, ever."
      footer={
        <>
          Already registered?{' '}
          <Link href="/login" className="text-gold-400 hover:text-gold-300">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
