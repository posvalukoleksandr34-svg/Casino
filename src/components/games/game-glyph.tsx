import { cn } from '@/lib/cn';

/** Decorative per-game illustration (original artwork, pure SVG). */
export function GameGlyph({ id, className }: { id: string; className?: string }) {
  const common = { fill: 'none', stroke: 'url(#gg-gold)', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 96 96" className={cn('size-20', className)} aria-hidden="true">
      <defs>
        <linearGradient id="gg-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3e6c2" />
          <stop offset="1" stopColor="#a7853f" />
        </linearGradient>
      </defs>
      {id === 'roulette' && (
        <g {...common}>
          <circle cx="48" cy="48" r="36" />
          <circle cx="48" cy="48" r="26" />
          <circle cx="48" cy="48" r="7" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return <line key={i} x1={48 + Math.cos(a) * 26} y1={48 + Math.sin(a) * 26} x2={48 + Math.cos(a) * 36} y2={48 + Math.sin(a) * 36} />;
          })}
          <circle cx="48" cy="17" r="2.6" fill="#ebe8e2" stroke="none" />
        </g>
      )}
      {id === 'dice' && (
        <g {...common}>
          <rect x="18" y="26" width="40" height="40" rx="8" transform="rotate(-12 38 46)" />
          <rect x="44" y="30" width="34" height="34" rx="7" transform="rotate(14 61 47)" />
          <circle cx="30" cy="40" r="2.4" fill="#d9bb76" stroke="none" />
          <circle cx="41" cy="51" r="2.4" fill="#d9bb76" stroke="none" />
          <circle cx="36" cy="58" r="2.4" fill="#d9bb76" stroke="none" />
          <circle cx="61" cy="47" r="2.4" fill="#d9bb76" stroke="none" />
        </g>
      )}
      {id === 'crash' && (
        <g {...common}>
          <path d="M14 78 C 40 76, 58 60, 80 18" />
          <path d="M70 18h10v10" />
          <line x1="14" y1="80" x2="84" y2="80" opacity="0.5" />
        </g>
      )}
      {id === 'mines' && (
        <g {...common}>
          {Array.from({ length: 9 }, (_, i) => (
            <rect key={i} x={20 + (i % 3) * 20} y={20 + Math.floor(i / 3) * 20} width="16" height="16" rx="3" opacity={i === 4 ? 1 : 0.55} />
          ))}
          <path d="M48 42l2.4 3.6 4.2 1.2-2.6 3.4.1 4.3-4.1-1.5-4.1 1.5.1-4.3-2.6-3.4 4.2-1.2z" fill="#d9bb76" stroke="none" />
        </g>
      )}
      {id === 'blackjack' && (
        <g {...common}>
          <rect x="20" y="22" width="34" height="48" rx="5" transform="rotate(-10 37 46)" />
          <rect x="42" y="24" width="34" height="48" rx="5" transform="rotate(8 59 48)" />
          <path d="M57 42c3-4 9-2 6 3l-6 6-6-6c-3-5 3-7 6-3z" fill="#d9bb76" stroke="none" />
        </g>
      )}
      {id === 'slots' && (
        <g {...common}>
          <rect x="14" y="24" width="68" height="48" rx="8" />
          <line x1="36.7" y1="24" x2="36.7" y2="72" opacity="0.6" />
          <line x1="59.3" y1="24" x2="59.3" y2="72" opacity="0.6" />
          <path d="M20 48h10M43 48h10M66 48h10" />
          <circle cx="25" cy="36" r="3" fill="#d9bb76" stroke="none" />
          <circle cx="48" cy="60" r="3" fill="#d9bb76" stroke="none" />
          <circle cx="71" cy="36" r="3" fill="#d9bb76" stroke="none" />
        </g>
      )}
    </svg>
  );
}
