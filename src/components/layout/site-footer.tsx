import Link from 'next/link';
import { Wordmark } from './logo';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-ink-800">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-400">
            A virtual-currency casino built on published rules and verifiable outcomes. Chips have no monetary value and cannot be
            bought, sold, withdrawn or exchanged.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-300">
            <span className="font-semibold text-gold-400">18+</span> Play for entertainment only
          </p>
        </div>
        <FooterCol title="Play" links={[['/lobby', 'Game lobby'], ['/sports', 'Sports predictions'], ['/history', 'Game history'], ['/stats', 'Statistics']]} />
        <FooterCol title="Transparency" links={[['/rules', 'Rules & odds'], ['/fairness', 'Provably fair'], ['/fairness#verify', 'Verify a round']]} />
        <FooterCol title="Your account" links={[['/wallet', 'Wallet'], ['/settings', 'Settings & privacy'], ['/responsible-play', 'Responsible play']]} />
      </div>
      <div className="border-t border-ink-800/70">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-ink-400 sm:px-6">
          <span>© {new Date().getUTCFullYear()} Aurovane — demonstration platform. Not licensed for real-money gambling.</span>
          <span>Every game has a house edge: over time, players are expected to lose chips.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">{title}</div>
      <ul className="mt-4 space-y-2.5">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="text-sm text-ink-300 hover:text-gold-300">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
