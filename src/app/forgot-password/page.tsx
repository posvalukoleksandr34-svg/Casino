import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/password-forms';

export const metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset password" subtitle="We will send a single-use link that expires in 30 minutes.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
