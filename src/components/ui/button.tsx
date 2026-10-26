import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-gold-400 to-gold-600 text-ink-950 font-semibold shadow-[0_1px_0_rgb(255_255_255/0.35)_inset,0_6px_20px_-8px_rgb(199_163_91/0.6)] hover:from-gold-300 hover:to-gold-500 disabled:from-ink-600 disabled:to-ink-700 disabled:text-ink-400 disabled:shadow-none',
  secondary: 'border border-ink-600 bg-ink-800 text-ink-100 hover:border-gold-600 hover:bg-ink-750 disabled:text-ink-400 disabled:hover:border-ink-600',
  ghost: 'text-ink-200 hover:bg-ink-800 hover:text-ink-100 disabled:text-ink-400',
  subtle: 'border border-ink-700 bg-ink-850 text-ink-200 hover:border-ink-500 hover:text-ink-100 disabled:text-ink-400',
  danger: 'border border-negative/50 bg-negative/10 text-negative hover:bg-negative/20 disabled:opacity-50',
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
        'inline-flex select-none items-center justify-center whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed',
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
