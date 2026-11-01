/**
 * Inline stroke icons (24×24 grid, currentColor). Drawn for Aurovane; the
 * project ships no icon library.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

/** Counter-clockwise arrow (undo). */
export const RotateCcwIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3" />
    <path d="M3 3v5.3h5.3" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7" />
    <path d="M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7" />
  </Icon>
);

/** Two arrows in a loop (repeat the previous bet). */
export const RepeatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17 2.5l3 3-3 3" />
    <path d="M4 11V9.5a4 4 0 0 1 4-4h12" />
    <path d="M7 21.5l-3-3 3-3" />
    <path d="M20 13v1.5a4 4 0 0 1-4 4H4" />
  </Icon>
);

/** A chip with a minus (remove mode). */
export const ChipMinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" strokeDasharray="2 2.2" />
    <path d="M9.5 12h5" />
  </Icon>
);

export const VolumeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5L6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </Icon>
);

export const VolumeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5L6 9H3v6h3l5 4z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
);

export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
