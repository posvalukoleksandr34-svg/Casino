import { cn } from '@/lib/cn';

/** Original monogram: a faceted lozenge with an inset "A" chevron. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true">
      <defs>
        <linearGradient id="av-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3e6c2" />
          <stop offset="0.6" stopColor="#c7a35b" />
          <stop offset="1" stopColor="#7b622f" />
        </linearGradient>
      </defs>
      <path d="M16 1.5 30.5 16 16 30.5 1.5 16Z" fill="none" stroke="url(#av-g)" strokeWidth="1.5" />
      <path d="M16 6.5 25.5 16 16 25.5 6.5 16Z" fill="url(#av-g)" opacity="0.14" />
      <path d="M10.5 21.5 16 9.5l5.5 12M12.8 17h6.4" fill="none" stroke="url(#av-g)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="font-display text-[1.6rem] font-semibold leading-none tracking-[0.04em] text-ink-100">
        Auro<span className="gold-text">vane</span>
      </span>
    </span>
  );
}
