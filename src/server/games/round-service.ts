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
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { GameRuleError, type GameModule, type RiskProfile, type StepResult } from '@/engine/games/types';
import { getGameModule } from '@/engine/games/registry';
import { createRandomStream } from '@/engine/rng/provably-fair';
import { sumMinor } from '@/engine/money';
import { getDb, withTransaction, type Tx } from '../db/client';
import { bets, gameRounds, games, payouts, seedPairs } from '../db/schema';
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
import { loadActiveGame, loadConfigById, parseWith, requireGameId } from './catalog';

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
}

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

function assessOrThrow(mod: GameModule, config: unknown, bet: unknown): RiskProfile {
  try {
    return mod.assess(config, bet);
  } catch (err) {
    throw asRuleError(err);
  }
}

function asRuleError(err: unknown): unknown {
  if (err instanceof GameRuleError) return new AppError('GAME_RULE', err.message, { rule: err.code, ...(err.details ?? {}) });
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

async function lockOpenRound(tx: Tx, userId: string, roundId: string): Promise<RoundRow> {
  const [round] = await tx
    .select()
    .from(gameRounds)
    .where(and(eq(gameRounds.id, roundId), eq(gameRounds.userId, userId)))
    .for('update');
  if (!round) throw errors.notFound('Round');
  if (round.status !== 'OPEN') throw errors.conflict('This round has already finished', { status: round.status });
  return round;
}

export interface ActInput {
  userId: string;
  roundId: string;
  action: unknown;
  idempotencyKey: string;
  sessionStartedAt?: Date | null;
  now?: Date;
}

export async function actOnRound(input: ActInput): Promise<IdempotentResult<RoundResponse>> {
  return withTransaction((tx) =>
    runIdempotent(tx, input.userId, input.idempotencyKey, requestFingerprint(`round:act:${input.roundId}`, input.action), async (respond) => {
      const wallet = await lockWalletAccount(tx, input.userId);
      const round = await lockOpenRound(tx, input.userId, input.roundId);
      const mod = getGameModule(requireGameId(round.gameId));
      if (!mod.actionSchema) throw new AppError('GAME_RULE', 'This game does not accept actions');
      const config = await loadConfigById(tx, mod, round.configId);
      const action = parseWith(mod.actionSchema, input.action, 'action');
      const now = input.now ?? new Date();
      let step: StepResult<unknown>;
      try {
        step = mod.act(config, round.state, action, { elapsedMs: now.getTime() - round.startedAt.getTime() });
      } catch (err) {
        throw asRuleError(err);
      }
      let body: RoundResponse | undefined;
      await applyStep(tx, round, mod, config, mod.name, wallet, step, input.sessionStartedAt ?? null, async (status, b) => {
        body = b;
        await respond(status, b);
      });
      return { status: 200, body: body! };
    }),
  );
}

/**
 * Settles a round whose result is determined by elapsed time (e.g. a crash
 * round that busted while the player was away). Safe to call repeatedly.
 */
export async function expireRoundIfDue(roundId: string, now = new Date()): Promise<boolean> {
  return withTransaction(async (tx) => {
    const [peek] = await tx.select({ userId: gameRounds.userId, status: gameRounds.status }).from(gameRounds).where(eq(gameRounds.id, roundId));
    if (!peek || peek.status !== 'OPEN') return false;
    const wallet = await lockWalletAccount(tx, peek.userId);
    const [round] = await tx.select().from(gameRounds).where(eq(gameRounds.id, roundId)).for('update');
    if (!round || round.status !== 'OPEN') return false;
    const mod = getGameModule(requireGameId(round.gameId));
    const config = await loadConfigById(tx, mod, round.configId);
    const step = mod.expire(config, round.state, { elapsedMs: now.getTime() - round.startedAt.getTime() });
    if (!step) return false;
    await applyStep(tx, round, mod, config, mod.name, wallet, step, null);
    return true;
  });
}

export async function expireDueRounds(now = new Date(), limit = 200): Promise<number> {
  const rows = await getDb()
    .select({ id: gameRounds.id })
    .from(gameRounds)
    .where(and(eq(gameRounds.status, 'OPEN'), lt(gameRounds.startedAt, new Date(now.getTime() - 1000))))
    .orderBy(asc(gameRounds.startedAt))
    .limit(limit);
  let n = 0;
  for (const r of rows) if (await expireRoundIfDue(r.id, now)) n += 1;
  return n;
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
      .set({ status: 'VOIDED', settledAt: now, updatedAt: now, voidReason: input.reason })
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
