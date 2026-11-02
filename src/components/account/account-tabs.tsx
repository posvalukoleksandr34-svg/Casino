'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const TABS = [
  { href: '/profile', label: 'Overview' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/wallet/transactions', label: 'Transactions' },
  { href: '/promotions', label: 'Bonuses' },
  { href: '/rewards', label: 'Rewards' },
  { href: '/vip', label: 'VIP' },
  { href: '/history', label: 'Game history' },
  { href: '/profile/achievements', label: 'Achievements' },
  { href: '/settings/security', label: 'Security' },
  { href: '/settings', label: 'Personal settings' },
  { href: '/responsible-play', label: 'Responsible gaming' },
];

/** The player's account sections as one tab bar, shown on each of those pages. */
export function AccountTabs() {
  const pathname = usePathname();
  // The most specific tab that matches wins (/wallet/transactions over /wallet).
  const current = TABS.filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Account" className="-mt-3 mb-6 overflow-x-auto pb-1" data-testid="account-tabs">
      <ul className="flex min-w-max gap-1 border-b border-white/[0.08]">
        {TABS.map((t) => {
          const on = t.href === current;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={cn('-mb-px inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors', on ? 'border-gold-400 text-gold-200' : 'border-transparent text-ink-300 hover:text-ink-100')}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
