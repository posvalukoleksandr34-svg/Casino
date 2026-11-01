import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'border border-gold-300/40 bg-gradient-to-b from-gold-300 via-gold-400 to-gold-600 text-ink-950 font-semibold shadow-[0_1px_0_rgb(255_255_255/0.45)_inset,0_-1px_0_rgb(0_0_0/0.15)_inset,0_8px_24px_-10px_rgb(199_163_91/0.7)] hover:brightness-110 hover:shadow-[0_1px_0_rgb(255_255_255/0.5)_inset,0_10px_30px_-10px_rgb(199_163_91/0.85)] active:brightness-95 disabled:border-transparent disabled:from-ink-600 disabled:to-ink-700 disabled:text-ink-400 disabled:shadow-none disabled:brightness-100',
  secondary:
    'border border-white/12 bg-white/[0.06] text-ink-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.07)] backdrop-blur-md hover:border-gold-400/50 hover:bg-white/[0.1] active:bg-white/[0.04] disabled:text-ink-400 disabled:hover:border-white/12 disabled:hover:bg-white/[0.06]',
  ghost: 'text-ink-200 hover:bg-white/[0.07] hover:text-ink-100 active:bg-white/[0.04] disabled:text-ink-400',
  subtle:
    'border border-white/[0.09] bg-white/[0.035] text-ink-200 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] backdrop-blur-md hover:border-white/20 hover:bg-white/[0.07] hover:text-ink-100 active:bg-white/[0.03] disabled:text-ink-400',
  danger: 'border border-negative/50 bg-negative/10 text-negative backdrop-blur-md hover:bg-negative/20 disabled:opacity-50',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-base rounded-xl gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, block = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,box-shadow,filter,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});
