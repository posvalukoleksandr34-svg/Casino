import Link from 'next/link';
import { cn } from '@/lib/cn';
import { GameCover } from './game-cover';

/** A compact game card: cover art with the name and RTP over it, linking to the game. */
export function GameTile({ id, name, rtp, isNew, paused, className }: { id: string; name: string; rtp: string; isNew?: boolean; paused?: boolean; className?: string }) {
  return (
    <Link
      href={`/games/${id}`}
      className={cn('group relative block overflow-hidden rounded-2xl ring-1 ring-white/10 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-18px_rgb(199_163_91/0.6)] hover:ring-gold-400/50', className)}
      data-game-tile={id}
    >
      <GameCover id={id} className="aspect-[4/3] w-full transition-transform duration-500 group-hover:scale-[1.04]">
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2.5 pt-8">
          <div className="truncate font-display text-lg font-semibold leading-tight text-white">{name}</div>
          <div className="num text-[11px] text-gold-200/90">RTP {rtp}</div>
        </div>
        {(isNew || paused) && (
          <span className={cn('absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', paused ? 'bg-black/60 text-ink-200' : 'bg-gold-400 text-ink-950')}>
            {paused ? 'Paused' : 'New'}
          </span>
        )}
      </GameCover>
    </Link>
  );
}
