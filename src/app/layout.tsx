import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { RealityCheck } from '@/components/layout/reality-check';
import { SessionProvider, type ClientUser } from '@/components/layout/session-provider';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { ToastProvider } from '@/components/ui/toast';
import { hasPermission } from '@/server/auth/rbac';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { getWalletAccount } from '@/server/ledger/accounts';
import { getPlatformSettings } from '@/server/risk/risk-service';

export const metadata: Metadata = {
  title: { default: 'Aurovane — virtual casino, verifiable odds', template: '%s · Aurovane' },
  description: 'A virtual-currency casino with published mathematics, provably fair outcomes and server-authoritative games.',
};

export const viewport: Viewport = { themeColor: '#0a0b0d', width: 'device-width', initialScale: 1 };

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  const db = getDb();
  const balance = session ? ((await getWalletAccount(db, session.userId))?.balance ?? 0) : 0;
  const settings = await getPlatformSettings(db).catch(() => null);
  const user: ClientUser | null = session
    ? {
        id: session.userId,
        email: session.email,
        username: session.username,
        role: session.role,
        isStaff: hasPermission(session.role, 'admin:access'),
        preferences: session.preferences,
        sessionStartedAt: session.sessionCreatedAt.toISOString(),
      }
    : null;
  const reduceMotion = Boolean(session?.preferences?.reducedMotion);
  return (
    <html lang="en" className={reduceMotion ? 'reduce-motion' : undefined}>
      <body className="flex min-h-dvh flex-col antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-gold-500 focus:px-4 focus:py-2 focus:text-ink-950">
          Skip to content
        </a>
        <SessionProvider initialUser={user} initialBalance={balance}>
          <ToastProvider>
            {settings && !settings.newRoundsEnabled && (
              <div role="status" className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
                {settings.incidentMessage || 'New game rounds are temporarily paused. Open rounds can still be completed.'}
              </div>
            )}
            <SiteHeader />
            <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-10 sm:px-6">
              {children}
            </main>
            <SiteFooter />
            <RealityCheck />
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
