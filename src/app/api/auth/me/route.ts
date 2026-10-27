import { hasPermission } from '@/server/auth/rbac';
import { getDb } from '@/server/db/client';
import { route } from '@/server/http/handler';
import { getWalletAccount } from '@/server/ledger/accounts';

export const GET = route({ name: 'auth.me', auth: 'optional', onboarding: 'allow' }, async ({ session }) => {
  if (!session) return { user: null };
  const wallet = await getWalletAccount(getDb(), session.userId);
  return {
    user: {
      id: session.userId,
      email: session.email,
      username: session.username,
      role: session.role,
      isStaff: hasPermission(session.role, 'admin:access'),
      preferences: session.preferences,
      displayName: session.displayName,
      avatar: session.avatar,
      sessionStartedAt: session.sessionCreatedAt.toISOString(),
      onboardingPending: session.onboardingPending,
    },
    balance: wallet?.balance ?? 0,
  };
});
