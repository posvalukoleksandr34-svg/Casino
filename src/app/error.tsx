'use client';

import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <h1 className="font-display text-4xl text-ink-100">Something went wrong</h1>
      <p className="mt-3 text-sm text-ink-400">
        The page failed to load. No funds move as a result of a failed page load.
        {error.digest && <span className="block pt-2 font-mono text-xs text-ink-400">Reference: {error.digest}</span>}
      </p>
      <button type="button" onClick={reset} className="mt-6 inline-flex h-10 items-center rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">
        Try again
      </button>
    </div>
  );
}
