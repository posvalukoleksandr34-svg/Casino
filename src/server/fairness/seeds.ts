/**
 * Provably-fair seed management.
 *
 * Each player has exactly one ACTIVE seed pair: a secret server seed (stored
 * encrypted, only its SHA-256 commitment is shown), a client seed the player
 * may choose, and a nonce that increments with every round. Rotating reveals
 * the old server seed so every past round can be verified independently, and
 * commits to a fresh one. Rotation is refused while a round that uses the
 * active seed is still open, because revealing the seed would expose that
 * round's predetermined outcome (e.g. mine positions).
 */
import { and, desc, eq } from 'drizzle-orm';
import { hashServerSeed, isValidClientSeed } from '@/engine/rng/provably-fair';
import { decryptSecret, encryptSecret, randomHex } from '../crypto';
import type { Executor, Tx } from '../db/client';
import { gameRounds, seedPairs } from '../db/schema';
import { errors } from '../errors';

export function generateServerSeed(): string {
  return randomHex(32);
}

export function defaultClientSeed(): string {
  return randomHex(10);
}

export async function createSeedPair(db: Executor, userId: string, clientSeed = defaultClientSeed()) {
  if (!isValidClientSeed(clientSeed)) throw errors.validation('Client seed must be 1–64 printable characters without spaces');
  const serverSeed = generateServerSeed();
  const [row] = await db
    .insert(seedPairs)
    .values({
      userId,
      serverSeedEnc: encryptSecret(serverSeed),
      serverSeedHash: hashServerSeed(serverSeed),
      clientSeed,
    })
    .returning();
  return row!;
}

export interface ReservedNonce {
  seedPairId: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/**
 * Locks the player's active seed pair and consumes the next nonce. Because
 * (seed_pair_id, nonce) is UNIQUE on game_rounds and the nonce only ever
 * increases (DB trigger), randomness can never be reused.
 */
export async function reserveNonce(tx: Tx, userId: string): Promise<ReservedNonce> {
  let [pair] = await tx
    .select()
    .from(seedPairs)
    .where(and(eq(seedPairs.userId, userId), eq(seedPairs.status, 'ACTIVE')))
    .for('update');
  if (!pair) pair = await createSeedPair(tx, userId);
  await tx
    .update(seedPairs)
    .set({ nextNonce: pair.nextNonce + 1 })
    .where(eq(seedPairs.id, pair.id));
  return {
    seedPairId: pair.id,
    serverSeed: decryptSecret(pair.serverSeedEnc),
    serverSeedHash: pair.serverSeedHash,
    clientSeed: pair.clientSeed,
    nonce: pair.nextNonce,
  };
}

/** Decrypts the server seed of a specific pair (server-side only, e.g. for interactive rounds). */
export async function serverSeedFor(db: Executor, seedPairId: number): Promise<string> {
  const [pair] = await db.select({ enc: seedPairs.serverSeedEnc }).from(seedPairs).where(eq(seedPairs.id, seedPairId));
  if (!pair) throw new Error(`seed pair ${seedPairId} not found`);
  return decryptSecret(pair.enc);
}

export async function rotateSeed(tx: Tx, userId: string, newClientSeed?: string) {
  if (newClientSeed !== undefined && !isValidClientSeed(newClientSeed)) {
    throw errors.validation('Client seed must be 1–64 printable characters without spaces');
  }
  const [active] = await tx
    .select()
    .from(seedPairs)
    .where(and(eq(seedPairs.userId, userId), eq(seedPairs.status, 'ACTIVE')))
    .for('update');
  let revealed: { serverSeed: string; serverSeedHash: string; clientSeed: string; finalNonce: number } | null = null;
  if (active) {
    const [open] = await tx
      .select({ id: gameRounds.id })
      .from(gameRounds)
      .where(and(eq(gameRounds.seedPairId, active.id), eq(gameRounds.status, 'OPEN')))
      .limit(1);
    if (open) {
      throw errors.conflict('Finish your active rounds before rotating seeds; revealing the seed would expose their outcomes.');
    }
    const serverSeed = decryptSecret(active.serverSeedEnc);
    await tx
      .update(seedPairs)
      .set({ status: 'REVEALED', revealedAt: new Date(), revealedServerSeed: serverSeed })
      .where(eq(seedPairs.id, active.id));
    revealed = {
      serverSeed,
      serverSeedHash: active.serverSeedHash,
      clientSeed: active.clientSeed,
      finalNonce: active.nextNonce,
    };
  }
  const next = await createSeedPair(tx, userId, newClientSeed ?? defaultClientSeed());
  return {
    revealed,
    active: { serverSeedHash: next.serverSeedHash, clientSeed: next.clientSeed, nextNonce: next.nextNonce },
  };
}

export async function fairnessOverview(db: Executor, userId: string, limit = 20) {
  const rows = await db
    .select({
      id: seedPairs.id,
      status: seedPairs.status,
      serverSeedHash: seedPairs.serverSeedHash,
      clientSeed: seedPairs.clientSeed,
      nextNonce: seedPairs.nextNonce,
      createdAt: seedPairs.createdAt,
      revealedAt: seedPairs.revealedAt,
      revealedServerSeed: seedPairs.revealedServerSeed,
    })
    .from(seedPairs)
    .where(eq(seedPairs.userId, userId))
    .orderBy(desc(seedPairs.id))
    .limit(limit);
  const active = rows.find((r) => r.status === 'ACTIVE') ?? null;
  return {
    active: active
      ? { serverSeedHash: active.serverSeedHash, clientSeed: active.clientSeed, nextNonce: active.nextNonce, createdAt: active.createdAt }
      : null,
    revealed: rows
      .filter((r) => r.status === 'REVEALED')
      .map((r) => ({
        serverSeedHash: r.serverSeedHash,
        serverSeed: r.revealedServerSeed,
        clientSeed: r.clientSeed,
        nonceCount: r.nextNonce,
        createdAt: r.createdAt,
        revealedAt: r.revealedAt,
      })),
  };
}
