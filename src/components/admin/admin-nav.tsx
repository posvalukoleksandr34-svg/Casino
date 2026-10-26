'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface NavItem {
  href: string;
  label: string;
}

export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto lg:flex-col">
      {items.map((i) => {
        const active = i.href === '/admin' ? pathname === '/admin' : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors',
              active ? 'bg-ink-800 text-gold-200' : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100',
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
