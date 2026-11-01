'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useSession } from './session-provider';

const TABS = [
  { href: '/lobby', label: 'Lobby', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' },
  { href: '/sports', label: 'Sports', icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7l3.5 2.5-1.3 4h-4.4l-1.3-4z' },
  { href: '/history', label: 'History', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7.5V12l3 2' },
  { href: '/wallet', label: 'Wallet', icon: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7.5h16a1 1 0 0 1 1 1V11M20 11h-4a2 2 0 0 0 0 4h4z' },
  { href: '/profile', label: 'Profile', icon: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0' },
];

/**
 * Bottom tab bar for signed-in players on phones and tablets: the five most
 * used destinations within thumb reach. Hidden on large screens (the header
 * navigation covers them) and during onboarding.
 */
export function MobileTabBar() {
  const { user } = useSession();
  const pathname = usePathname();
  if (!user || user.onboardingPending) return null;
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === '/lobby' && pathname.startsWith('/games/'));
  return (
    <>
      {/* Space so the last content is never hidden behind the bar. */}
      <div className="h-[calc(4.25rem+env(safe-area-inset-bottom))] lg:hidden" aria-hidden="true" />
      <nav
        aria-label="Quick navigation"
        className="mobile-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-ink-950/70 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_30px_-18px_rgb(0_0_0/0.9)] backdrop-blur-2xl backdrop-saturate-150 lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.map((t) => {
            const on = active(t.href);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={on ? 'page' : undefined}
                  className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors', on ? 'text-gold-200' : 'text-ink-300 hover:text-ink-100')}
                >
                  <span className={cn('grid h-7 w-11 place-items-center rounded-full transition-colors', on && 'bg-gold-500/15 shadow-[inset_0_0_0_1px_rgb(199_163_91/0.3)]')}>
                    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d={t.icon} />
                    </svg>
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
