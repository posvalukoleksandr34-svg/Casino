'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { formatChips } from '@/engine/money';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Wordmark } from './logo';
import { useSession } from './session-provider';
import { Avatar } from '../account/avatar';

const NAV = [
  { href: '/lobby', label: 'Lobby' },
  { href: '/sports', label: 'Sports' },
  { href: '/rules', label: 'Rules & odds' },
  { href: '/fairness', label: 'Fairness' },
  { href: '/responsible-play', label: 'Responsible play' },
];

const ACCOUNT_LINKS = [
  { href: '/profile', label: 'Profile' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/wallet/transactions', label: 'Transactions' },
  { href: '/history', label: 'Game history' },
  { href: '/sports/tickets', label: 'My predictions' },
  { href: '/stats', label: 'Statistics' },
  { href: '/settings', label: 'Settings' },
];

export function SiteHeader() {
  const { user, balance } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hideBalance = Boolean(user?.preferences?.hideBalance);

  useEffect(() => {
    setMenuOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    router.push('/');
    router.refresh();
  }

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  if (user?.onboardingPending) {
    // Until the profile step is done only onboarding is available (the server enforces it).
    return (
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/55 shadow-[0_10px_30px_-20px_rgb(0_0_0/0.9)] backdrop-blur-2xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/onboarding" className="shrink-0" aria-label="Aurovane — finish your profile">
            <Wordmark />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/onboarding" className="hidden rounded-xl border border-gold-700/60 px-3 py-1.5 text-sm text-gold-200 sm:inline-flex">
              Finish your profile
            </Link>
            <button type="button" onClick={signOut} className="rounded-xl px-3 py-2 text-sm text-ink-300 hover:text-ink-100">
              Sign out
            </button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-ink-950/55 shadow-[0_10px_30px_-20px_rgb(0_0_0/0.9)] backdrop-blur-2xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-5 px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="Aurovane home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-0.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? 'page' : undefined}
              className={cn(
                'rounded-xl px-3.5 py-1.5 text-sm transition-[background-color,color,box-shadow] duration-150',
                active(n.href) ? 'bg-white/[0.08] text-gold-200 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_0_1px_rgb(199_163_91/0.25)]' : 'text-ink-300 hover:bg-white/[0.05] hover:text-ink-100',
              )}
            >
              {n.label}
            </Link>
          ))}
          {user?.isStaff && (
            <Link href="/admin" className={cn('rounded-xl px-3.5 py-1.5 text-sm', active('/admin') ? 'bg-white/[0.08] text-gold-200' : 'text-ink-300 hover:bg-white/[0.05] hover:text-ink-100')}>
              Admin
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link
                href="/wallet"
                className="group hidden items-center gap-2 rounded-xl border border-gold-500/35 bg-gold-500/[0.07] px-3 py-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-md transition-colors hover:border-gold-400/60 hover:bg-gold-500/[0.12] sm:flex"
                aria-label={hideBalance ? 'Wallet' : `Balance ${formatChips(balance)} chips`}
              >
                <span className="size-2 rotate-45 bg-gold-500" aria-hidden="true" />
                <span className="num text-sm font-semibold text-gold-200" data-testid="header-balance">
                  {hideBalance ? '••••' : formatChips(balance)}
                </span>
                <span className="text-[10px] font-medium tracking-wider text-ink-400">CHIPS</span>
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 pl-1.5 pr-3 text-sm text-ink-200 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-md transition-colors hover:border-white/20 hover:bg-white/[0.08]"
                >
                  {user.avatar ? (
                    <Avatar avatar={user.avatar} name={user.username} className="size-7 rounded-lg" />
                  ) : (
                    <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-gold-500 to-gold-700 text-xs font-bold uppercase text-ink-950" aria-hidden="true">
                      {user.username.slice(0, 2)}
                    </span>
                  )}
                  <span className="hidden max-w-28 truncate sm:inline">{user.displayName ?? user.username}</span>
                </button>
                {menuOpen && (
                  <div role="menu" className="glass absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl py-1.5 animate-rise">
                    {ACCOUNT_LINKS.map((l) => (
                      <Link key={l.href} role="menuitem" href={l.href} className="block px-4 py-2 text-sm text-ink-200 hover:bg-white/[0.06] hover:text-ink-100">
                        {l.label}
                      </Link>
                    ))}
                    {user.isStaff && (
                      <Link role="menuitem" href="/admin" className="block px-4 py-2 text-sm text-gold-300 hover:bg-white/[0.06]">
                        Admin dashboard
                      </Link>
                    )}
                    <div className="my-1.5 h-px bg-white/[0.08]" />
                    <button role="menuitem" type="button" onClick={signOut} className="block w-full px-4 py-2 text-left text-sm text-ink-300 hover:bg-white/[0.06] hover:text-ink-100">
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/login" className="whitespace-nowrap rounded-xl px-2 py-2 text-sm text-ink-200 hover:text-ink-100 sm:px-3">
                Sign in
              </Link>
              <Link href="/register" className="whitespace-nowrap rounded-xl border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 px-3 py-2 text-sm font-semibold sm:px-4 text-ink-950 shadow-[0_1px_0_rgb(255_255_255/0.45)_inset,0_8px_22px_-10px_rgb(199_163_91/0.7)] hover:brightness-110">
                <span className="sm:hidden">Join</span>
                <span className="hidden sm:inline">Create account</span>
              </Link>
            </>
          )}
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-ink-300 backdrop-blur-md hover:bg-white/[0.08] lg:hidden"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d={mobileOpen ? 'M5 5l10 10M15 5L5 15' : 'M3 6h14M3 10h14M3 14h14'} strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <nav aria-label="Mobile" className="border-t border-white/[0.07] px-4 py-3 lg:hidden">
          {[...NAV, ...(user?.isStaff ? [{ href: '/admin', label: 'Admin' }] : [])].map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-xl px-3 py-2.5 text-sm text-ink-200 hover:bg-white/[0.06]">
              {n.label}
            </Link>
          ))}
          {user && (
            <Link href="/wallet" className="mt-2 block rounded-xl px-3 py-2.5 text-sm text-gold-300 hover:bg-white/[0.06]">
              Balance: {hideBalance ? '••••' : formatChips(balance)} chips
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
