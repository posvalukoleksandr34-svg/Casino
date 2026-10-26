import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { currentSession } from '@/server/auth/current';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await currentSession()) redirect('/lobby');
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your virtual-chip account."
      footer={
        <>
          <Link href="/forgot-password" className="text-gold-400 hover:text-gold-300">
            Forgot password?
          </Link>
          <span className="mx-2 text-ink-600">·</span>
          New here?{' '}
          <Link href="/register" className="text-gold-400 hover:text-gold-300">
            Create an account
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
