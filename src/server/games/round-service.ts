/**
 * Orchestrates a game round: validation → responsible-play checks → wallet
 * lock → nonce reservation → risk evaluation → outcome → ledger postings →
 * persistence, all inside one database transaction. Either every effect of a
 * request commits (bet, round, ledger entries, payout, idempotency record) or
 * none does.
 *
 * Lock order (deadlock-free): player wallet → round row → seed pair →
 * house bankroll → wagers-in-play → other system accounts.
 */
import { and, asc, desc, eq, lt, lte, sql } from 'drizzle-orm';
import { GameRuleError, type GameModule, type RiskProfile, type StepResult } from '@/engine/games/types';
import { getGameModule } from '@/engine/games/registry';
import { createRandomStream } from '@/engine/rng/provably-fair';
import { MoneyError, sumMinor } from '@/engine/money';
import { getDb, withTransaction, type Tx } from '../db/client';
import { bets, gameRounds, games, payouts, seedPairs, users } from '../db/schema';
import { AppError, errors } from '../errors';
import { requestFingerprint, runIdempotent, type IdempotentResult } from '../idempotency';
import { lockWalletAccount, systemAccountIds } from '../ledger/accounts';
import { postTransaction } from '../ledger/ledger';
import { recordAdminAction } from '../audit/audit';
import { assertCanWager } from '../responsible/limits';
import { assertWagerAcceptable, getGameLimits, getPlatformSettings } from '../risk/risk-service';
import { reserveNonce } from '../fairness/seeds';
import { maybeFail } from '../testing/faults';
import { metrics } from '../observability/metrics';
import { captureError } from '../observability/errors';
import { logger } from '../observability/logger';
import { loadActiveGame, loadConfigById, parseWith, requireGameId } from './catalog';
import { decideTimedAction, settlementDeadline, settlementDue } from './action-timing';

type RoundRow = typeof gameRounds.$inferSelect;

export interface RoundView {
  id: string;
  gameId: string;
  status: 'OPEN' | 'SETTLED' | 'VOIDED';
  stake: number;
  payout: number | null;
  maxPayout: number;
  startedAt: string;
  settledAt: string | null;
  actionCount: number;
  state: unknown;
  fairness: { serverSeedHash: string; clientSeed: string; nonce: number; serverSeed: string | null };
  voidReason: string | null;
}

export interface RoundResponse {
  round: RoundView;
  balance: number;
  /**
   * Actions only: `applied`, or why a time-decided round was settled by time
   * instead (see action-timing.ts).
   */
  resolution?: ActionResolution;
}

export type ActionResolution = 'applied' | 'received_after_end' | 'processing_deadline_passed';

/**
 * Reads the clock that orders actions against time-based settlement. Called
 * only after the wallet and round locks are held. Production uses the
 * database clock, one clock for every application instance; tests inject a
 * controlled clock.
 */
export type RoundClock = (tx: Tx) => Promise<Date>;

export const databaseClock: RoundClock = async (tx) => {
  // Epoch milliseconds as a number: independent of the server's DateStyle and time zone.
  const res = await tx.execute<{ ms: number }>(sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms`);
  const ms = Number(res.rows[0]?.ms);
  if (!Number.isFinite(ms)) throw new Error('database clock returned no usable time');
  return new Date(Math.floor(ms));
};

function toView(mod: GameModule, config: unknown, row: RoundRow, revealedServerSeed: string | null = null): RoundView {
  const isFinal = row.status !== 'OPEN';
  return {
    id: row.id,
    gameId: row.gameId,
    status: row.status,
    stake: row.stakeTotal,
    payout: row.payoutTotal,
    maxPayout: row.maxPayout,
    startedAt: row.startedAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
    actionCount: row.actionCount,
    state: mod.view(config, row.state, isFinal),
    fairness: {
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      serverSeed: revealedServerSeed,
    },
    voidReason: row.voidReason,
  };
}

/**
 * Absolute server time at which an open state is decided by time alone (the
 * crash, an automatic target or the cap), from the engine's explicit expiry
 * capability (null: never decided by time).
 */
function timedEnd(mod: GameModule, config: unknown, state: unknown, startedAt: Date): Date | null {
  const ms = mod.expiresAfterMs(config, state);
  if (ms === null) return null;
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`${mod.id}: invalid expiry offset ${ms}`);
  return new Date(startedAt.getTime() + Math.ceil(ms));
}

/** When the expiry queue settles the round: the settlement deadline (end + grace), or null. */
function expiryFor(mod: GameModule, config: unknown, state: unknown, startedAt: Date): Date | null {
  const end = timedEnd(mod, config, state, startedAt);
  return end && settlementDeadline(end);
}

function assessOrThrow(mod: GameModule, config: unknown, bet: unknown): RiskProfile {
  try {
    return mod.assess(config, bet);
  } catch (err) {
    throw asRuleError(err);
  }
}

function asRuleError(err: unknown): unknown {
  if (err instanceof GameRuleError) return new AppError('GAME_RULE', err.message, { rule: err.code, ...(err.details ?? {}) });
  // Defence in depth: schemas bound every amount, but an out-of-range amount must
  // never surface as an internal error.
  if (err instanceof MoneyError) return new AppError('VALIDATION_ERROR', 'Amount is outside the supported range');
  return err;
}

/**
 * Posts the settlement: exactly once per round (ledger business key
 * `round:<id>:settle` and payouts.round_id are both UNIQUE).
 */
async function postSettlement(
  tx: Tx,
  round: Pick<RoundRow, 'id' | 'userId' | 'gameId'>,
  walletAccountId: number,
  stake: number,
  payout: number,
  gameName: string,
): Promise<void> {
  maybeFail('round.beforeSettle');
  const ids = await systemAccountIds(tx);
  const posted = await postTransaction(tx, {
    type: 'BET_SETTLED',
    idempotencyKey: `round:${round.id}:settle`,
    userId: round.userId,
    roundId: round.id,
    description: payout > 0 ? `${gameName} payout` : `${gameName} round settled`,
    postings: [
      { accountId: ids.WAGERS_IN_PLAY, amount: -stake, memo: 'release stake' },
      { accountId: ids.HOUSE_BANKROLL, amount: stake, memo: 'stake collected' },
      { accountId: ids.HOUSE_BANKROLL, amount: -payout, memo: 'payout funded' },
      { accountId: walletAccountId, amount: payout, memo: 'payout' },
    ],
    metadata: { gameId: round.gameId, stake, payout },
  });
  await tx.insert(payouts).values({ roundId: round.id, userId: round.userId, amount: payout, ledgerTransactionId: posted.id });
  maybeFail('round.afterSettle');
  metrics.inc('casino_rounds_settled_total', { game: round.gameId });
  metrics.inc('casino_stake_minor_total', { game: round.gameId }, stake);
  metrics.inc('casino_payout_minor_total', { game: round.gameId }, payout);
}

function assertPayout(step: StepResult<unknown>): void {
  if (!Number.isSafeInteger(step.payout) || step.payout < 0) throw new Error(`invalid payout ${step.payout}`);
  if (step.payout > step.risk.maxPayout) throw new Error(`payout ${step.payout} exceeds declared max payout ${step.risk.maxPayout}`);
}

async function recordWagers(
  tx: Tx,
  round: Pick<RoundRow, 'id' | 'userId' | 'gameId'>,
  walletAccountId: number,
  wagers: { kind: string; amount: number; selection?: Record<string, unknown> }[],
  firstSeq: number,
  gameName: string,
): Promise<void> {
  const total = sumMinor(wagers.map((w) => w.amount));
  const ids = await systemAccountIds(tx);
  const posted = await postTransaction(tx, {
    type: 'BET_PLACED',
    idempotencyKey: `round:${round.id}:bet:${firstSeq}`,
    userId: round.userId,
    roundId: round.id,
    description: firstSeq === 0 ? `${gameName} wager` : `${gameName} additional wager (${wagers.map((w) => w.kind).join(', ')})`,
    postings: [
      { accountId: walletAccountId, amount: -total, memo: 'stake' },
      { accountId: ids.WAGERS_IN_PLAY, amount: total, memo: 'stake held' },
    ],
    metadata: { gameId: round.gameId },
  });
  await tx.insert(bets).values(
    wagers.map((w, i) => ({
      roundId: round.id,
      userId: round.userId,
      seq: firstSeq + i,
      kind: w.kind,
      selection: w.selection ?? {},
      stake: w.amount,
      ledgerTransactionId: posted.id,
    })),
  );
  maybeFail('round.afterBetPosted');
}

export interface StartRoundInput {
  userId: string;
  gameId: string;
  bet: unknown;
  idempotencyKey: string;
  sessionStartedAt?: Date | null;
}

export async function startRound(input: StartRoundInput): Promise<IdempotentResult<RoundResponse>> {
  const gameId = requireGameId(input.gameId);
  return withTransaction((tx) =>
    runIdempotent(tx, input.userId, input.idempotencyKey, requestFingerprint(`round:start:${gameId}`, input.bet), async (respond) => {
      const game = await loadActiveGame(tx, gameId);
      if (game.status !== 'ACTIVE') {
        throw errors.gameUnavailable(game.statusReason || `${game.name} is not accepting new rounds right now.`);
      }
      const bet = parseWith(game.mod.betSchema, input.bet, 'bet');
      const risk = assessOrThrow(game.mod, game.config, bet);
      const wagers = game.mod.wagers(game.config, bet);
      if (sumMinor(wagers.map((w) => w.amount)) !== risk.stake) throw new Error('wager breakdown does not match stake');
      const settings = await getPlatformSettings(tx);
      const limits = await getGameLimits(tx, gameId);

      const wallet = await lockWalletAccount(tx, input.userId);
      await assertAccountActive(tx, input.userId);
      await assertCanWager(tx, input.userId, risk.stake, { sessionStartedAt: input.sessionStartedAt ?? null });
      if (wallet.balance < risk.stake) throw errors.insufficientFunds({ balance: wallet.balance, stake: risk.stake });
      const seed = await reserveNonce(tx, input.userId);

      // Acceptance is decided BEFORE any randomness is used, from the wager's
      // worst case (max payout) only: the decision cannot depend on the
      // outcome. This takes the house-bankroll lock (serialised section).
      await assertWagerAcceptable(
        tx,
        gameId,
        {
          newRound: true,
          gameStatus: game.status,
          initialStake: risk.stake,
          roundStake: risk.stake,
          roundMaxPayout: risk.maxPayout,
          playerBalance: wallet.balance,
          stakeDelta: risk.stake,
        },
        { settings, limits },
      );

      // The outcome is fully determined by (server seed, client seed, nonce),
      // committed before this request.
      let step: StepResult<unknown>;
      try {
        step = game.mod.start(game.config, bet, createRandomStream(seed));
      } catch (err) {
        throw asRuleError(err);
      }
      if (step.risk.stake !== risk.stake) throw new Error('engine stake mismatch');
      const settledNow = step.status === 'SETTLED';
      if (settledNow) assertPayout(step);
      const now = new Date();

      const [round] = await tx
        .insert(gameRounds)
        .values({
          userId: input.userId,
          gameId,
          configId: game.configId,
          status: settledNow ? 'SETTLED' : 'OPEN',
          seedPairId: seed.seedPairId,
          nonce: seed.nonce,
          clientSeed: seed.clientSeed,
          serverSeedHash: seed.serverSeedHash,
          stakeTotal: risk.stake,
          payoutTotal: settledNow ? step.payout : null,
          maxPayout: step.risk.maxPayout,
          expectedPayout: step.risk.expectedPayout,
          payoutVariance: step.risk.payoutVariance,
          state: step.state,
          startedAt: now,
          updatedAt: now,
          settledAt: settledNow ? now : null,
          expiresAt: settledNow ? null : expiryFor(game.mod, game.config, step.state, now),
        })
        .returning();
      const body: RoundResponse = {
        round: toView(game.mod, game.config, round!),
        balance: wallet.balance - risk.stake + (settledNow ? step.payout : 0),
      };
      await respond(201, body);
      await recordWagers(tx, round!, wallet.id, wagers, 0, game.name);
      if (settledNow) await postSettlement(tx, round!, wallet.id, risk.stake, step.payout, game.name);
      metrics.inc('casino_bets_total', { game: gameId });
      return { status: 201, body };
    }),
  );
}

/**
 * Applies an engine step to an open round. Order: player-scoped checks and the
 * round update first, then the serialised section (risk check and postings).
 */
async function applyStep(
  tx: Tx,
  round: RoundRow,
  mod: GameModule,
  config: unknown,
  gameName: string,
  walletAccount: { id: number; balance: number },
  step: StepResult<unknown>,
  sessionStartedAt: Date | null,
  respond?: (status: number, body: RoundResponse) => Promise<void>,
): Promise<RoundRow> {
  const extra = step.additionalStakes;
  const extraTotal = extra.length ? sumMinor(extra.map((s) => s.amount)) : 0;
  if (step.risk.stake !== round.stakeTotal + extraTotal) throw new Error('engine stake accounting mismatch');
  // Outcome-independent liability bound for the extra wagers (see AdditionalStake).
  const boundedMaxPayout = round.maxPayout + sumMinor(extra.map((s) => {
    if (s.maxAddedPayout === undefined) throw new Error(`additional wager ${s.kind} lacks a maxAddedPayout bound`);
    return s.maxAddedPayout;
  }));
  if (extraTotal > 0 && step.risk.maxPayout > boundedMaxPayout) {
    throw new Error('engine max payout exceeds the declared bound for the additional wager');
  }
  if (extraTotal > 0) {
    await assertCanWager(tx, round.userId, extraTotal, { sessionStartedAt });
    if (walletAccount.balance < extraTotal) {
      throw errors.insufficientFunds({ balance: walletAccount.balance, stake: extraTotal });
    }
  }
  const settledNow = step.status === 'SETTLED';
  if (settledNow) assertPayout(step);
  const now = new Date();
  const [updated] = await tx
    .update(gameRounds)
    .set({
      state: step.state,
      stakeTotal: step.risk.stake,
      maxPayout: step.risk.maxPayout,
      expectedPayout: step.risk.expectedPayout,
      payoutVariance: step.risk.payoutVariance,
      actionCount: round.actionCount + 1,
      updatedAt: now,
      expiresAt: settledNow ? null : expiryFor(mod, config, step.state, round.startedAt),
      ...(settledNow ? { status: 'SETTLED' as const, payoutTotal: step.payout, settledAt: now } : {}),
    })
    .where(eq(gameRounds.id, round.id))
    .returning();
  if (respond) {
    await respond(200, {
      round: toView(mod, config, updated!),
      balance: walletAccount.balance - extraTotal + (settledNow ? step.payout : 0),
    });
  }

  if (extraTotal > 0) {
    const [{ status: gameStatus } = { status: 'ACTIVE' as const }] = await tx
      .select({ status: games.status })
      .from(games)
      .where(eq(games.id, round.gameId));
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(bets)
      .where(eq(bets.roundId, round.id));
    await assertWagerAcceptable(
      tx,
      round.gameId,
      {
        newRound: false,
        gameStatus,
        initialStake: round.stakeTotal,
        roundStake: step.risk.stake,
        roundMaxPayout: boundedMaxPayout,
        playerBalance: walletAccount.balance,
        stakeDelta: extraTotal,
      },
      { roundId: round.id },
    );
    await recordWagers(tx, round, walletAccount.id, extra, n, gameName);
  }
  if (settledNow) await postSettlement(tx, round, walletAccount.id, step.risk.stake, step.payout, gameName);
  return updated!;
}

/**
 * The session was checked when the request arrived; a suspension or deletion
 * may have committed since. Re-checked under the wallet lock, which account
 * deletion also takes, so no wager or action lands on a closed account.
 */
async function assertAccountActive(tx: Tx, userId: string): Promise<void> {
  const [user] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
  if (user?.status !== 'ACTIVE') throw errors.unauthenticated('Your session has ended. Please sign in again.');
}

async function lockOpenRound(tx: Tx, userId: string, roundId: string): Promise<RoundRow> {
  const [round] = await tx
    .select()
    .from(gameRounds)
    .where(and(eq(gameRounds.id, roundId), eq(gameRounds.userId, userId)))
    .for('update');
  if (!round) throw errors.notFound('Round');
  if (round.status !== 'OPEN') {
    metrics.inc('casino_round_actions_total', { game: round.gameId, resolution: 'already_settled' });
    throw errors.conflict('This round has already finished', { status: round.status, resolution: 'already_settled' });
  }
  return round;
}

export interface ActInput {
  userId: string;
  roundId: string;
  action: unknown;
  idempotencyKey: string;
  sessionStartedAt?: Date | null;
  /** When the application received the request (the route wrapper sets it before any other work). */
  receivedAt?: Date;
  /** Ordering clock read under the locks (default: the database clock). */
  clock?: RoundClock;
}

export async function actOnRound(input: ActInput): Promise<IdempotentResult<RoundResponse>> {
  // Time-sensitive actions (a crash cash-out) are priced at the moment the
  // server received the request, not after waiting for row locks or a
  // serialisation retry: the documented rule, and fair under contention.
  const receivedAt = input.receivedAt ?? new Date();
  const clock = input.clock ?? databaseClock;
  return withTransaction((tx) =>
    runIdempotent(tx, input.userId, input.idempotencyKey, requestFingerprint(`round:act:${input.roundId}`, input.action), async (respond) => {
      const wallet = await lockWalletAccount(tx, input.userId);
      await assertAccountActive(tx, input.userId);
      const round = await lockOpenRound(tx, input.userId, input.roundId);
      const mod = getGameModule(requireGameId(round.gameId));
      if (!mod.actionSchema) throw new AppError('GAME_RULE', 'This game does not accept actions');
      const config = await loadConfigById(tx, mod, round.configId);
      const action = parseWith(mod.actionSchema, input.action, 'action');
      let step: StepResult<unknown> | null = null;
      let resolution: ActionResolution = 'applied';
      const end = timedEnd(mod, config, round.state, round.startedAt);
      if (end) {
        // Read under the locks: see action-timing.ts for why this ordering is race-free.
        const processedAt = await clock(tx);
        const decision = decideTimedAction({ receivedAt, processedAt, end });
        if (decision.kind !== 'apply') {
          metrics.inc('casino_round_actions_total', {
            game: round.gameId,
            resolution: decision.kind === 'reject_ended' ? 'received_after_end' : decision.resolution,
          });
        }
        if (decision.kind === 'reject_ended') {
          // Nothing changes: the round is settled by time from its deadline on.
          throw new AppError('GAME_RULE', 'The round had already ended when this request reached the server', {
            rule: 'ROUND_ENDED',
            resolution: 'received_after_end',
          });
        }
        if (decision.kind === 'settle_by_time') {
          resolution = decision.resolution;
          if (resolution === 'processing_deadline_passed') {
            logger.warn('timed action processed after the settlement deadline; settled by time', {
              roundId: round.id,
              gameId: round.gameId,
              receivedBeforeEndMs: end.getTime() - receivedAt.getTime(),
              processingDelayMs: processedAt.getTime() - receivedAt.getTime(),
            });
          }
          step = mod.expire(config, round.state, { elapsedMs: processedAt.getTime() - round.startedAt.getTime() });
          if (!step) throw new Error(`${round.gameId} round ${round.id} is past its settlement deadline but the engine did not settle it`);
        }
      }
      if (!step) {
        try {
          step = mod.act(config, round.state, action, { elapsedMs: receivedAt.getTime() - round.startedAt.getTime() });
        } catch (err) {
          throw asRuleError(err);
        }
      }
      let body: RoundResponse | undefined;
      await applyStep(tx, round, mod, config, mod.name, wallet, step, input.sessionStartedAt ?? null, async (status, b) => {
        body = end ? { ...b, resolution } : b;
        await respond(status, body);
      });
      if (end && resolution === 'applied') metrics.inc('casino_round_actions_total', { game: round.gameId, resolution });
      return { status: 200, body: body! };
    }),
  );
}

/**
 * Settles a round whose result is determined by elapsed time (e.g. a crash
 * round that busted while the player was away). Safe to call repeatedly and
 * concurrently: the wallet and round row locks serialise callers, the status
 * is re-checked under the lock, and the settlement ledger key is unique.
 *
 * Never settles before the settlement deadline (end + grace, action-timing.ts),
 * judged by `clock` read under the locks. A Date is a fixed reading (tests,
 * scripts). When the round is not yet due, its schedule is corrected from the
 * engine so that a stale or back-filled `expires_at` cannot keep it at the
 * head of the expiry queue.
 */
export async function expireRoundIfDue(roundId: string, clock: Date | RoundClock = databaseClock): Promise<boolean> {
  return withTransaction(async (tx) => {
    const [peek] = await tx.select({ userId: gameRounds.userId, status: gameRounds.status }).from(gameRounds).where(eq(gameRounds.id, roundId));
    if (!peek || peek.status !== 'OPEN') return false;
    const wallet = await lockWalletAccount(tx, peek.userId);
    const [round] = await tx.select().from(gameRounds).where(eq(gameRounds.id, roundId)).for('update');
    if (!round || round.status !== 'OPEN') return false;
    const mod = getGameModule(requireGameId(round.gameId));
    const config = await loadConfigById(tx, mod, round.configId);
    const end = timedEnd(mod, config, round.state, round.startedAt);
    const now = clock instanceof Date ? clock : await clock(tx);
    if (!end || !settlementDue(end, now)) {
      const next = end && settlementDeadline(end);
      if ((next?.getTime() ?? null) !== (round.expiresAt?.getTime() ?? null)) {
        await tx.update(gameRounds).set({ expiresAt: next }).where(eq(gameRounds.id, round.id));
      }
      return false;
    }
    const step = mod.expire(config, round.state, { elapsedMs: now.getTime() - round.startedAt.getTime() });
    if (!step) throw new Error(`${round.gameId} round ${round.id} is due since ${settlementDeadline(end).toISOString()} but the engine did not settle it`);
    await applyStep(tx, round, mod, config, mod.name, wallet, step, null);
    return true;
  });
}

/** Retry delay after a failed expiry attempt: 5 s doubling, capped at 1 hour. */
export function expiryBackoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.min(attempts, 20), 3_600_000);
}

/**
 * Moves a round that failed to expire behind the rest of the due queue, so a
 * single faulty round can never block the rounds after it.
 */
async function deferExpiry(roundId: string, now: Date, err: unknown): Promise<void> {
  captureError(err, { route: 'job:expire-rounds' });
  metrics.inc('casino_round_expiry_failures_total');
  try {
    await getDb()
      .update(gameRounds)
      .set({
        expiryAttempts: sql`${gameRounds.expiryAttempts} + 1`,
        expiresAt: sql`${now.toISOString()}::timestamptz + make_interval(secs => least(5 * power(2, least(${gameRounds.expiryAttempts}, 20)), 3600))`,
      })
      .where(and(eq(gameRounds.id, roundId), eq(gameRounds.status, 'OPEN')));
  } catch (deferErr) {
    logger.error('could not defer failed round expiry', { roundId, error: (deferErr as Error).message });
  }
}

/**
 * One bounded pass of the expiry queue: OPEN rounds whose engine-declared
 * expiry time has passed, oldest due first (partial index
 * game_rounds_expiry_due_idx). Rounds that can never expire by time have no
 * expiry time and are never selected; a round that fails is deferred with
 * backoff instead of being retried at the head of the next batch.
 */
export async function expireDueRounds(now?: Date, limit = 200): Promise<number> {
  const due = await getDb()
    .select({ id: gameRounds.id })
    .from(gameRounds)
    .where(and(eq(gameRounds.status, 'OPEN'), lte(gameRounds.expiresAt, now ?? sql`clock_timestamp()`)))
    .orderBy(asc(gameRounds.expiresAt), asc(gameRounds.id))
    .limit(limit);
  let settled = 0;
  for (const r of due) {
    try {
      if (await expireRoundIfDue(r.id, now ?? databaseClock)) settled += 1;
    } catch (err) {
      await deferExpiry(r.id, now ?? new Date(), err);
    }
  }
  if (settled) metrics.inc('casino_rounds_expired_total', {}, settled);
  return settled;
}

export async function openRounds(userId: string): Promise<RoundView[]> {
  const db = getDb();
  const rows = await db
    .select({ id: gameRounds.id })
    .from(gameRounds)
    .where(and(eq(gameRounds.userId, userId), eq(gameRounds.status, 'OPEN')));
  for (const r of rows) await expireRoundIfDue(r.id);
  const fresh = await db.select().from(gameRounds).where(and(eq(gameRounds.userId, userId), eq(gameRounds.status, 'OPEN')));
  const views: RoundView[] = [];
  for (const row of fresh) {
    const mod = getGameModule(requireGameId(row.gameId));
    views.push(toView(mod, await loadConfigById(db, mod, row.configId), row));
  }
  return views;
}

export async function getRoundForUser(userId: string | null, roundId: string): Promise<RoundView & { userId: string }> {
  const db = getDb();
  const [row] = await db
    .select({ round: gameRounds, revealed: seedPairs.revealedServerSeed })
    .from(gameRounds)
    .innerJoin(seedPairs, eq(seedPairs.id, gameRounds.seedPairId))
    .where(userId ? and(eq(gameRounds.id, roundId), eq(gameRounds.userId, userId)) : eq(gameRounds.id, roundId));
  if (!row) throw errors.notFound('Round');
  const mod = getGameModule(requireGameId(row.round.gameId));
  const config = await loadConfigById(db, mod, row.round.configId);
  return { ...toView(mod, config, row.round, row.revealed), userId: row.round.userId };
}

export interface RoundListItem {
  id: string;
  gameId: string;
  status: string;
  stake: number;
  payout: number | null;
  startedAt: string;
  settledAt: string | null;
  summary: unknown;
}

export async function listRounds(opts: {
  userId?: string;
  gameId?: string;
  status?: 'OPEN' | 'SETTLED' | 'VOIDED';
  before?: Date;
  limit?: number;
}): Promise<RoundListItem[]> {
  const db = getDb();
  const conds = [
    opts.userId ? eq(gameRounds.userId, opts.userId) : undefined,
    opts.gameId ? eq(gameRounds.gameId, opts.gameId) : undefined,
    opts.status ? eq(gameRounds.status, opts.status) : undefined,
    opts.before ? lt(gameRounds.startedAt, opts.before) : undefined,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  const rows = await db
    .select()
    .from(gameRounds)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(gameRounds.startedAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  const out: RoundListItem[] = [];
  for (const row of rows) {
    const mod = getGameModule(requireGameId(row.gameId));
    const config = await loadConfigById(db, mod, row.configId);
    out.push({
      id: row.id,
      gameId: row.gameId,
      status: row.status,
      stake: row.stakeTotal,
      payout: row.payoutTotal,
      startedAt: row.startedAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
      summary: mod.view(config, row.state, row.status !== 'OPEN'),
    });
  }
  return out;
}

/**
 * Administrative void of an OPEN round: the stake is returned in full via a
 * ROUND_VOIDED ledger transaction. Settled rounds can never be voided or
 * altered. Recorded as an admin action with a mandatory reason.
 */
export async function voidRound(input: { roundId: string; adminId: string; reason: string; ipHash?: string | null; requestId?: string | null }) {
  return withTransaction(async (tx) => {
    const [peek] = await tx.select({ userId: gameRounds.userId }).from(gameRounds).where(eq(gameRounds.id, input.roundId));
    if (!peek) throw errors.notFound('Round');
    const wallet = await lockWalletAccount(tx, peek.userId);
    const round = await lockOpenRound(tx, peek.userId, input.roundId);
    const ids = await systemAccountIds(tx);
    await postTransaction(tx, {
      type: 'ROUND_VOIDED',
      idempotencyKey: `round:${round.id}:void`,
      userId: round.userId,
      roundId: round.id,
      actorId: input.adminId,
      description: 'Round voided — stake returned',
      postings: [
        { accountId: ids.WAGERS_IN_PLAY, amount: -round.stakeTotal, memo: 'release stake' },
        { accountId: wallet.id, amount: round.stakeTotal, memo: 'stake refund' },
      ],
      metadata: { reason: input.reason },
    });
    const now = new Date();
    await tx
      .update(gameRounds)
      .set({ status: 'VOIDED', settledAt: now, updatedAt: now, voidReason: input.reason, expiresAt: null })
      .where(eq(gameRounds.id, round.id));
    await recordAdminAction(tx, {
      adminId: input.adminId,
      action: 'round.void',
      targetType: 'game_round',
      targetId: round.id,
      reason: input.reason,
      before: { status: 'OPEN', stake: round.stakeTotal },
      after: { status: 'VOIDED', refunded: round.stakeTotal },
      ipHash: input.ipHash ?? null,
      requestId: input.requestId ?? null,
    });
    return { roundId: round.id, refunded: round.stakeTotal };
  });
}
