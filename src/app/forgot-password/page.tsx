import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/password-forms';
import { Callout } from '@/components/ui/misc';
import { passwordRecoveryMode } from '@/server/users/accounts';

export const metadata = { title: 'Reset password' };
export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  const recovery = passwordRecoveryMode();
  if (recovery === 'unavailable') {
    return (
      <AuthShell title="Reset password" subtitle="Password recovery by e-mail is not set up on this site.">
        <Callout tone="warning" title="Recovery e-mail unavailable" role="status">
          This deployment has no e-mail provider configured, so we cannot send reset links. Please contact support to regain access to
          your account.
        </Callout>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Reset password"
      subtitle={recovery === 'email' ? 'We will e-mail a single-use link that expires in 30 minutes.' : 'Development mode: the single-use link is printed in the server console.'}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
