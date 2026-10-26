import { pocketColor } from '@/engine/games/roulette/rules';

/** One-line, neutral description of a round outcome for history lists. */
export function summarizeRound(gameId: string, state: unknown, status: string): string {
  if (status === 'VOIDED') return 'Voided — stake returned';
  const s = state as Record<string, unknown> | null;
  if (!s) return '';
  switch (gameId) {
    case 'roulette': {
      const n = s.result as number;
      return `${n} ${pocketColor(n)}`;
    }
    case 'dice': {
      const roll = ((s.roll as number) / 100).toFixed(2);
      const target = ((s.target as number) / 100).toFixed(2);
      return `Rolled ${roll} · ${s.direction === 'under' ? 'under' : 'over'} ${target}`;
    }
    case 'crash': {
      if (s.crashPoint === undefined) return status === 'OPEN' ? 'In flight' : '';
      const cp = ((s.crashPoint as number) / 100).toFixed(2);
      return s.cashedOutAt ? `Cashed out ${((s.cashedOutAt as number) / 100).toFixed(2)}× · crashed ${cp}×` : `Crashed at ${cp}×`;
    }
    case 'mines': {
      const picks = (s.revealed as number[] | undefined)?.length ?? 0;
      if (status === 'OPEN') return `${picks} safe pick${picks === 1 ? '' : 's'} so far`;
      return s.hitMine ? `Hit a mine after ${picks} safe pick${picks === 1 ? '' : 's'}` : `Cashed out after ${picks} pick${picks === 1 ? '' : 's'}`;
    }
    case 'blackjack': {
      const result = s.outcomeSummary as string | undefined;
      return result ?? (status === 'OPEN' ? 'Hand in progress' : '');
    }
    case 'slots': {
      const wins = (s.lineWins as unknown[] | undefined)?.length ?? 0;
      const scatter = (s.scatterCount as number | undefined) ?? 0;
      return wins || scatter >= 3 ? `${wins} line win${wins === 1 ? '' : 's'}${scatter >= 3 ? ` · ${scatter} scatters` : ''}` : 'No win';
    }
    default:
      return '';
  }
}
