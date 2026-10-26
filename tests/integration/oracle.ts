/** Test-only outcome oracle: recomputes the next dice roll from the player's committed seed. */
import { and, eq } from 'drizzle-orm';
import { DICE_OUTCOMES } from '@/engine/games/dice';
import { createRandomStream } from '@/engine/rng/provably-fair';
import { decryptSecret } from '@/server/crypto';
import { getDb } from '@/server/db/client';
import { seedPairs } from '@/server/db/schema';

export async function nextDiceRoll(userId: string): Promise<number> {
  const [pair] = await getDb().select().from(seedPairs).where(and(eq(seedPairs.userId, userId), eq(seedPairs.status, 'ACTIVE')));
  if (!pair) throw new Error('no active seed pair');
  return createRandomStream({ serverSeed: decryptSecret(pair.serverSeedEnc), clientSeed: pair.clientSeed, nonce: pair.nextNonce }).nextInt(DICE_OUTCOMES);
}

/** A dice bet (≥ 1% win chance) that certainly loses on the player's next nonce. */
export async function losingDiceBet(userId: string, amount: number) {
  const roll = await nextDiceRoll(userId);
  // under t wins iff roll < t; over t wins iff roll > t.
  return roll >= 100 ? { amount, target: 100, direction: 'under' as const } : { amount, target: 9898, direction: 'over' as const };
}
