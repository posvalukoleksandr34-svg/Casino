import type { ReactNode } from 'react';

/** Long-form policy text with consistent headings and spacing. */
export function PolicySection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="font-display text-2xl font-semibold text-ink-100">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-300 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">{children}</div>
    </section>
  );
}
