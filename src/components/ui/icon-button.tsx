'use client';

import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name; also the tooltip's first line. */
  label: string;
  icon?: ReactNode;
  /** Extra tooltip text (e.g. why the button is unavailable). Announced as the description. */
  hint?: string | null;
  /** Visible text next to the icon (the button is then pill-shaped). */
  text?: ReactNode;
  size?: 'sm' | 'md';
  tone?: 'default' | 'gold';
  pressed?: boolean;
  tooltipSide?: 'top' | 'bottom';
  /** Tooltip alignment: centred, or kept inside the screen for buttons near an edge ('start-sm-end': left-aligned on phones, right-aligned from the sm breakpoint). */
  tooltipAlign?: 'center' | 'start' | 'end' | 'start-sm-end';
}

/**
 * A round icon button with a tooltip on hover and keyboard focus.
 * Unavailable buttons stay focusable (`aria-disabled`), so keyboard and
 * screen-reader users can still read why; clicks on them do nothing.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, hint, text, size = 'md', tone = 'default', pressed, tooltipSide = 'top', tooltipAlign = 'center', disabled, onClick, className, ...rest },
  ref,
) {
  const tipId = useId();
  return (
    <span className="group/tip relative inline-flex">
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-describedby={tipId}
        aria-disabled={disabled || undefined}
        aria-pressed={pressed}
        onClick={(e) => {
          if (disabled) {
            e.preventDefault();
            return;
          }
          onClick?.(e);
        }}
        className={cn(
          'inline-flex select-none items-center justify-center gap-1.5 rounded-full border font-semibold transition-[background-color,border-color,color,transform,box-shadow] duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400',
          'active:translate-y-px active:scale-[0.96] aria-disabled:active:scale-100 aria-disabled:active:translate-y-0',
          text ? (size === 'sm' ? 'h-9 px-3 text-xs' : 'h-11 px-4 text-sm') : size === 'sm' ? 'size-9' : 'size-11',
          tone === 'gold' || pressed
            ? 'border-gold-500/70 bg-gold-500/15 text-gold-200 hover:bg-gold-500/25'
            : 'border-ink-600 bg-ink-850 text-ink-200 hover:border-gold-600 hover:bg-ink-750 hover:text-ink-100',
          'aria-disabled:cursor-not-allowed aria-disabled:border-ink-700 aria-disabled:bg-ink-900 aria-disabled:text-ink-400 aria-disabled:hover:border-ink-700 aria-disabled:hover:bg-ink-900',
          className,
        )}
        {...rest}
      >
        {icon ? <span className={size === 'sm' ? 'size-4' : 'size-[18px]'}>{icon}</span> : null}
        {text}
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-30 w-max max-w-[220px] rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-center text-xs font-medium text-ink-100 opacity-0 shadow-lg transition-opacity duration-150',
          'group-hover/tip:opacity-100 group-has-[:focus-visible]/tip:opacity-100',
          tooltipSide === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          { center: 'left-1/2 -translate-x-1/2', start: 'left-0', end: 'right-0', 'start-sm-end': 'left-0 sm:left-auto sm:right-0' }[tooltipAlign],
        )}
      >
        {label}
        {hint ? <span className="mt-0.5 block font-normal text-ink-300">{hint}</span> : null}
      </span>
    </span>
  );
});
