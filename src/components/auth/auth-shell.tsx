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
    <div className={cn('mx-auto py-6 animate-rise', wide ? 'max-w-2xl' : 'max-w-md')}>
      {step && <SignupSteps current={step} />}
      <div className="mb-8 text-center">
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-4 font-display text-4xl font-semibold text-ink-100">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-400">{subtitle}</p>}
      </div>
      <div className="surface p-6 sm:p-8">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-ink-400">{footer}</div>}
    </div>
  );
}
