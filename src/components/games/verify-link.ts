/** Builds the verifier query string (game parameters needed to recompute the outcome). */
export function verifyQueryForRound(round: { gameId: string; state: unknown; fairness: { serverSeed: string | null; clientSeed: string; nonce: number } }): string {
  const q = new URLSearchParams({
    game: round.gameId,
    clientSeed: round.fairness.clientSeed,
    nonce: String(round.fairness.nonce),
  });
  if (round.fairness.serverSeed) q.set('serverSeed', round.fairness.serverSeed);
  const s = round.state as Record<string, unknown> | null;
  if (round.gameId === 'mines' && s && typeof s.mineCount === 'number') q.set('mines', String(s.mineCount));
  if (round.gameId === 'blackjack' && s && typeof s.decks === 'number') {
    q.set('decks', String(s.decks));
    // Every card dealt in the round (hands + dealer), so the verifier shows them all.
    const hands = Array.isArray(s.hands) ? (s.hands as { cards?: unknown[] }[]) : [];
    const dealt = hands.reduce((n, h) => n + (h.cards?.length ?? 0), 0) + (Array.isArray(s.dealer) ? s.dealer.length : 0);
    if (dealt > 0) q.set('cards', String(Math.max(dealt, 24)));
  }
  return q.toString();
}
