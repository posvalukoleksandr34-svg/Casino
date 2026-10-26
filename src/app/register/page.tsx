import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';
import { currentSession } from '@/server/auth/current';

export const metadata = { title: 'Create account' };

export default async function RegisterPage() {
  if (await currentSession()) redirect('/lobby');
  return (
    <AuthShell
      title="Create your account"
      subtitle="Virtual chips only. No payment details, ever."
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
