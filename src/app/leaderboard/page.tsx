import Link from 'next/link';
import { PageHeader } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { pageSession } from '@/server/auth/current';
import { levelBoard, weeklyMultipliers } from '@/server/users/leaderboard';

export const metadata = { title: 'Leaderboard' };

type Board = Awaited<ReturnType<typeof weeklyMultipliers>>;

export default async function LeaderboardPage() {
  const session = await pageSession();
  const viewer = session && !session.onboardingPending ? session.userId : null;
  const [multipliers, levels] = await Promise.all([weeklyMultipliers(viewer), levelBoard(viewer)]);
  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="Leaderboard"
        subtitle="Only players who chose to show their name appear here (Settings → Show my name). Nothing is won by ranking: there are no prizes, and no board rewards how much you play."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <BoardCard
          title="Best multiplier this week"
          subtitle="Each player's best payout ÷ stake in the last 7 days (stakes of at least 1 credit)."
          board={multipliers}
          format={(v) => `${(v / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}×`}
          testId="board-multipliers"
        />
        <BoardCard
          title="Highest level"
          subtitle="Levels are cosmetic. Experience comes from days with play (capped at 30 rounds a day), games tried and achievements."
          board={levels}
          format={(v) => `${v.toLocaleString('en-US')} XP`}
          testId="board-levels"
        />
      </div>
      {!viewer && (
        <p className="mt-6 text-center text-sm text-ink-400">
          <Link href="/login?next=/leaderboard" className="text-gold-400 hover:text-gold-300">
            Sign in
          </Link>{' '}
          to see your own standing.
        </p>
      )}
    </>
  );
}

function BoardCard({ title, subtitle, board, format, testId }: { title: string; subtitle: string; board: Board; format: (v: number) => string; testId: string }) {
  return (
    <section className="surface p-6" aria-label={title} data-testid={testId}>
      <h2 className="font-display text-2xl font-semibold text-ink-100">{title}</h2>
      <p className="mt-1 text-xs text-ink-400">{subtitle}</p>
      {board.top.length === 0 ? (
        <p className="mt-6 text-sm text-ink-400">No one on this board yet.</p>
      ) : (
        <ol className="mt-4 divide-y divide-white/[0.06]">
          {board.top.map((r) => (
            <li key={`${r.rank}-${r.name}`} className={cn('flex items-center gap-3 py-2.5', r.you && 'rounded-lg bg-gold-400/[0.07] px-2')}>
              <span
                className={cn(
                  'num grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                  r.rank === 1 ? 'bg-gradient-to-b from-gold-200 to-gold-500 text-ink-950' : r.rank === 2 ? 'bg-gradient-to-b from-[#f2f4f8] to-[#9aa3b2] text-ink-950' : r.rank === 3 ? 'bg-gradient-to-b from-[#f2c39a] to-[#a8642c] text-ink-950' : 'bg-white/[0.06] text-ink-300',
                )}
              >
                {r.rank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink-100">
                  {r.name}
                  {r.you && <span className="ml-2 text-[11px] text-gold-300">you</span>}
                </span>
                <span className="block truncate text-xs text-ink-400">{r.detail}</span>
              </span>
              <span className="num font-semibold text-gold-200">{format(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
      {board.you && !board.top.some((r) => r.you) && (
        <p className="mt-4 rounded-lg border border-white/10 px-3 py-2 text-sm text-ink-300">
          Your standing: <span className="num font-semibold text-ink-100">#{board.you.rank}</span> · {format(board.you.value)} · {board.you.detail}
        </p>
      )}
    </section>
  );
}
