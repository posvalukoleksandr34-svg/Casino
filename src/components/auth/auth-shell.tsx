import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { LogoMark } from '../layout/logo';
import { SignupSteps } from './signup-steps';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  step,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Registration step (1–3) to show the progress indicator. */
  step?: 1 | 2 | 3;
  wide?: boolean;
}) {
  return (
    <div className={cn('relative mx-auto py-6 animate-rise', wide ? 'max-w-2xl' : 'max-w-md')}>
      {/* Soft gold light behind the form. */}
      <div className="pointer-events-none absolute inset-x-0 top-16 -z-10 h-[28rem] bg-[radial-gradient(farthest-side,rgb(199_163_91/0.13),transparent)]" aria-hidden="true" />
      {step && <SignupSteps current={step} />}
      <div className="mb-8 text-center">
        <LogoMark className="mx-auto size-12 drop-shadow-[0_0_18px_rgb(199_163_91/0.45)]" />
        <h1 className="mt-4 font-display text-4xl font-semibold text-ink-100">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-400">{subtitle}</p>}
      </div>
      <div className="surface p-6 sm:p-8">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-ink-400">{footer}</div>}
      <ul className="mt-8 flex flex-wrap justify-center gap-2 text-[11px] text-ink-300" aria-label="About Aurovane">
        {['Virtual chips only', 'Nothing to buy', 'No cash prizes', '18+'].map((t) => (
          <li key={t} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 backdrop-blur-md">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
