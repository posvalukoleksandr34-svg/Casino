import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <div className="font-display text-8xl text-gold-500/80">404</div>
      <h1 className="mt-4 font-display text-3xl text-ink-100">This table does not exist</h1>
      <p className="mt-2 text-sm text-ink-400">The page you were looking for could not be found.</p>
      <Link href="/lobby" className="mt-6 inline-flex h-10 items-center rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">
        Back to the lobby
      </Link>
    </div>
  );
}
