'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'info' | 'positive' | 'negative' | 'warning';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const Ctx = createContext<{ push: (t: Omit<ToastItem, 'id'>) => void } | null>(null);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    seq += 1;
    const id = seq;
    setItems((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), t.tone === 'negative' ? 7000 : 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'negative' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto surface animate-rise border-l-4 px-4 py-3',
              t.tone === 'positive' && 'border-l-positive',
              t.tone === 'negative' && 'border-l-negative',
              t.tone === 'warning' && 'border-l-warning',
              t.tone === 'info' && 'border-l-gold-500',
            )}
          >
            <div className="text-sm font-semibold text-ink-100">{t.title}</div>
            {t.body && <div className="mt-0.5 text-xs text-ink-300">{t.body}</div>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
