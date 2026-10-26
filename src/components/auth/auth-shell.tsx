import type { ReactNode } from 'react';
import { LogoMark } from '../layout/logo';

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-6 animate-rise">
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
