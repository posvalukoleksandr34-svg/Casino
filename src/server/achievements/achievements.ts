/**
 * Cosmetic achievements. Each badge is derived on the server from facts the
 * platform already records (rounds, seed pairs, limits, profile fields, and a
 * server-side fairness check), so a client can never award itself one.
 * Awards are idempotent (one row per player and badge, append-only table) and
 * carry no balance, prize or other value. None is tied to losses, stake size
 * or the number of rounds played.
 */
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { getGameModule } from '@/engine/games/registry';
import { cardLabel } from '@/engine/games/hilo';
import { label as blackjackLabel } from '@/engine/games/blackjack/cards';
import { verifyOutcome } from '@/engine/verify';
import { getDb, type Executor } from '../db/client';
import { gameRounds, responsibleLimits, seedPairs, userAchievements, users } from '../db/schema';
import { errors } from '../errors';
import { loadConfigById, requireGameId } from '../games/catalog';

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  /** How to earn it, shown while it is locked. */
  hint: string;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: 'first-round', title: 'First round', description: 'Completed your first round.', hint: 'Finish any round in any game.' },
  { id: 'profile-set', title: 'Made it yours', description: 'Chose a display name and an avatar.', hint: 'Pick a display name and an avatar on your profile.' },
  {
    id: 'seed-rotated',
    title: 'Fresh seed',
    description: 'Rotated your provably fair seed, revealing the previous server seed.',
    hint: 'Rotate your seed on the Provably fair page.',
  },
  {
    id: 'fairness-verified',
    title: 'Checked the maths',
    description: 'Had the server recompute one of your rounds from its revealed seed and confirm the stored result.',
    hint: 'After rotating your seed, open a round from that seed and choose “Check this round on the server”.',
  },
  {
    id: 'first-prediction',
    title: 'Called it',
    description: 'Had a sports prediction settled.',
    hint: 'Make a prediction in Sports and wait for its result.',
  },
  {
    id: 'limits-set',
    title: 'In control',
    description: 'Set a loss, wager or session limit.',
    hint: 'Set any limit on the Responsible play page.',
  },
];

export interface AchievementStatus extends AchievementDefinition {
  earned: boolean;
  awardedAt: string | null;
}

async function award(db: Executor, userId: string, achievementId: string, evidence: Record<string, unknown> = {}): Promise<void> {
  await db.insert(userAchievements).values({ userId, achievementId, evidence }).onConflictDoNothing();
}

/** Recomputes the fact-derived badges and stores any newly earned ones. */
export async function evaluateAchievements(userId: string, db: Executor = getDb()): Promise<AchievementStatus[]> {
  const [facts] = await db
    .select({
      settled: sql<boolean>`EXISTS (SELECT 1 FROM ${gameRounds} WHERE ${gameRounds.userId} = ${userId} AND ${gameRounds.status} = 'SETTLED')`,
      revealed: sql<boolean>`EXISTS (SELECT 1 FROM ${seedPairs} WHERE ${seedPairs.userId} = ${userId} AND ${seedPairs.status} = 'REVEALED')`,
      predicted: sql<boolean>`EXISTS (SELECT 1 FROM sports_tickets WHERE user_id = ${userId} AND status IN ('WON', 'LOST', 'VOIDED'))`,
      displayName: users.displayName,
      avatar: users.avatar,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!facts) throw errors.notFound('User');
  const [limits] = await db
    .select({ userId: responsibleLimits.userId })
    .from(responsibleLimits)
    .where(
      and(
        eq(responsibleLimits.userId, userId),
        or(
          isNotNull(responsibleLimits.dailyLossLimit),
          isNotNull(responsibleLimits.weeklyLossLimit),
          isNotNull(responsibleLimits.dailyWagerLimit),
          isNotNull(responsibleLimits.sessionLimitMinutes),
        ),
      ),
    );
  if (facts.settled) await award(db, userId, 'first-round');
  if (facts.displayName && facts.avatar) await award(db, userId, 'profile-set');
  if (facts.revealed) await award(db, userId, 'seed-rotated');
  if (facts.predicted) await award(db, userId, 'first-prediction');
  if (limits) await award(db, userId, 'limits-set');
  return listAchievements(userId, db);
}

export async function listAchievements(userId: string, db: Executor = getDb()): Promise<AchievementStatus[]> {
  const rows = await db.select().from(userAchievements).where(eq(userAchievements.userId, userId));
  const earned = new Map(rows.map((r) => [r.achievementId, r.awardedAt]));
  return ACHIEVEMENTS.map((a) => ({ ...a, earned: earned.has(a.id), awardedAt: earned.get(a.id)?.toISOString() ?? null }));
}

/**
 * The part of a stored round that the seeds alone determine, in the
 * verifier's own representation (so the two can be compared directly).
 */
function storedOutcome(gameId: string, state: Record<string, unknown>, cards: number): unknown {
  switch (gameId) {
    case 'roulette':
      return state.result;
    case 'dice':
      return state.roll;
    case 'crash':
      return state.crashE2;
    case 'limbo':
      return state.resultE2;
    case 'mines':
      return [...(state.mines as number[])].sort((a, b) => a - b);
    case 'keno':
      return state.drawn;
    case 'plinko':
      return (state.path as number[]).map((b) => (b ? 'R' : 'L')).join('');
    case 'blackjack':
      return (state.shoe as number[]).slice(0, cards).map(blackjackLabel);
    case 'hilo':
      return (state.sequence as number[]).slice(0, cards).map(cardLabel);
    default:
      throw errors.validation('This game has no server-side check');
  }
}

function recomputedOutcome(gameId: string, outcome: Record<string, unknown>): unknown {
  switch (gameId) {
    case 'roulette':
      return outcome.pocket;
    case 'dice':
      return outcome.roll;
    case 'crash':
      return outcome.crashE2;
    case 'limbo':
      return outcome.resultE2;
    case 'mines':
      return outcome.mines;
    case 'keno':
      return outcome.drawn;
    case 'plinko':
      return outcome.path;
    case 'blackjack':
      return outcome.firstCards;
    case 'hilo':
      return outcome.cards;
    default:
      return undefined;
  }
}

/** True when the verifier's outcome equals the seed-determined part of the stored round state. */
export function outcomeMatches(gameId: string, outcome: Record<string, unknown>, state: Record<string, unknown>, cards: number): boolean {
  const recomputed = recomputedOutcome(gameId, outcome);
  return recomputed !== undefined && JSON.stringify(recomputed) === JSON.stringify(storedOutcome(gameId, state, cards));
}

export interface ServerVerification {
  roundId: string;
  gameId: string;
  matches: boolean;
  description: string;
  serverSeedHash: string;
}

/**
 * Recomputes a settled round of the player's own from its revealed server
 * seed, client seed and nonce with the published verifier, and compares the
 * result with what the round recorded. A match earns "Checked the maths".
 */
export async function verifyRoundOnServer(userId: string, roundId: string): Promise<ServerVerification> {
  const db = getDb();
  const [row] = await db
    .select({ round: gameRounds, revealed: seedPairs.revealedServerSeed, hash: seedPairs.serverSeedHash })
    .from(gameRounds)
    .innerJoin(seedPairs, eq(seedPairs.id, gameRounds.seedPairId))
    .where(and(eq(gameRounds.id, roundId), eq(gameRounds.userId, userId)));
  if (!row) throw errors.notFound('Round');
  if (row.round.status !== 'SETTLED') throw errors.conflict('Only settled rounds can be checked');
  if (!row.revealed) throw errors.conflict('This round’s server seed is still secret. Rotate your seed to reveal it, then check again.');
  const gameId = requireGameId(row.round.gameId);
  const config = (await loadConfigById(db, getGameModule(gameId), row.round.configId)) as Record<string, unknown>;
  const state = row.round.state as Record<string, unknown>;
  const cards = gameId === 'hilo' ? (state.steps as unknown[]).length : gameId === 'blackjack' ? Math.max(24, (state.next as number) ?? 0) : 0;
  const params: Record<string, unknown> = {
    houseEdgeBp: config.houseEdgeBp,
    mines: state.mineCount,
    decks: state.decks,
    rows: state.rows,
    cards: cards || undefined,
  };
  const result = verifyOutcome(gameId, { serverSeed: row.revealed, clientSeed: row.round.clientSeed, nonce: row.round.nonce }, params);
  const matches = result.serverSeedHash === row.round.serverSeedHash && outcomeMatches(gameId, result.outcome, state, cards);
  if (matches) await award(db, userId, 'fairness-verified', { roundId });
  return { roundId, gameId, matches, description: result.description, serverSeedHash: result.serverSeedHash };
}
