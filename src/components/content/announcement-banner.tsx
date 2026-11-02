import Link from 'next/link';
import { cn } from '@/lib/cn';

export interface AnnouncementView {
  id: number;
  title: string;
  body: string;
  link: string | null;
  tone: 'info' | 'promo' | 'warning';
}

const TONES: Record<AnnouncementView['tone'], string> = {
  info: 'border-info/30 bg-info/[0.06]',
  promo: 'border-gold-500/40 bg-[radial-gradient(120%_140%_at_0%_0%,rgb(199_163_91/0.16),transparent_60%)]',
  warning: 'border-warning/40 bg-warning/[0.06]',
};

/** Announcements and banners managed in Admin → Content (plain text; site-relative links only). */
export function AnnouncementBanner({ items, className = 'mb-6' }: { items: AnnouncementView[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={cn('space-y-2', className)} data-testid="announcements">
      {items.map((a) => (
        <div key={a.id} role="note" className={cn('flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3', TONES[a.tone])}>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink-100">{a.title}</div>
            <div className="text-sm text-ink-300">{a.body}</div>
          </div>
          {a.link && (
            <Link href={a.link} className="shrink-0 text-sm font-medium text-gold-300 hover:text-gold-200">
              Details →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
