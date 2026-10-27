'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Input } from './form';

/** Password field with a show/hide toggle; the toggle is a real button announced to screen readers. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput({ className, ...rest }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} {...rest} type={visible ? 'text' : 'password'} className={`pr-20 ${className ?? ''}`} spellCheck={false} autoCapitalize="none" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-1 right-1 rounded-lg px-3 text-xs font-medium text-ink-300 hover:bg-ink-800 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
});
