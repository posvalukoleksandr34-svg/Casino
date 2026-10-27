import type { SVGProps } from 'react';

/** Small line icons for the back office (20×20, currentColor, decorative). */
const PATHS = {
  overview: 'M3 10.5 10 4l7 6.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z',
  analytics: 'M4 16V9m4 7V5m4 11v-5m4 5V7',
  users: 'M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 8a5 5 0 0 1 10 0m1.5-8.2a2.5 2.5 0 1 0 0-5m1.5 13.2a4.5 4.5 0 0 0-3-4.2',
  ledger: 'M4 3.5h12v13H4zM7 7h6M7 10h6M7 13h3',
  rounds: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-11v4l2.5 2.5',
  games: 'M3.5 7.5h13v7a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2zM6 5l2-2h4l2 2M7.5 11h2m-1-1v2M12.5 11.5h.01',
  sports: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-11 3 2.2-1.1 3.6H8.1L7 8.2Z',
  risk: 'M10 3 3.5 5.5V10c0 3.6 2.8 6.4 6.5 7 3.7-.6 6.5-3.4 6.5-7V5.5z',
  alerts: 'M10 3.5a4.5 4.5 0 0 0-4.5 4.5v3L4 13.5h12L14.5 11V8A4.5 4.5 0 0 0 10 3.5Zm-2 12a2 2 0 0 0 4 0',
  reconciliation: 'M4 7h10l-3-3M16 13H6l3 3',
  audit: 'M6 3.5h6l3 3v10H6zM12 3.5v3h3M8.5 10h4m-4 3h4',
  health: 'M3 10h3l2-5 4 10 2-5h3',
  security: 'M6.5 9V7a3.5 3.5 0 0 1 7 0v2m-8.5 0h10v7.5H5z',
  menu: 'M3.5 6h13M3.5 10h13M3.5 14h13',
  collapse: 'M12.5 5 7.5 10l5 5',
  expand: 'M7.5 5l5 5-5 5',
  external: 'M11 4h5v5m0-5-7 7M9 5H5v10h10v-4',
} as const;

export type AdminIconName = keyof typeof PATHS;

export function AdminIcon({ name, className, ...rest }: { name: AdminIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className ?? 'size-[18px] shrink-0'} {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
