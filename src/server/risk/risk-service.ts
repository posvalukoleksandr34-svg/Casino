import { eq, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client';
import { platformSettings, riskLimits } from '../db/schema';
import { errors } from '../errors';
import { lockAccount, systemAccountIds } from '../ledger/accounts';
import { evaluateWager, type ExposureSnapshot, type GameLimits, type PlatformLimits, type WagerProposal } from './evaluate';

export async function getPlatformSettings(db: Executor) {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1));
  if (!row) throw new Error('platform settings missing; run bootstrap');
  return row;
}

export async function getGameLimits(db: Executor, gameId: string): Promise<GameLimits> {
  const [row] = await db.select().from(riskLimits).where(eq(riskLimits.gameId, gameId));
  if (!row) throw new Error(`risk limits missing for ${gameId}`);
  return {
    minStake: row.minStake,
    maxStake: row.maxStake,
    maxPayoutPerRound: row.maxPayoutPerRound,
    maxGameExposure: row.maxGameExposure,
  };
}

/** Open (unsettled) net exposure, optionally for one game and excluding one round. */
export async function openExposure(db: Executor, opts: { gameId?: string; excludeRoundId?: string } = {}): Promise<number> {
  const res = await db.execute<{ total: string }>(sql`
    SELECT coalesce(sum(greatest(max_payout - stake_total, 0)), 0)::text AS total
    FROM game_rounds
    WHERE status = 'OPEN'
      ${opts.gameId ? sql`AND game_id = ${opts.gameId}` : sql``}
      ${opts.excludeRoundId ? sql`AND id <> ${opts.excludeRoundId}` : sql``}
  `);
  return Number(res.rows[0]?.total ?? 0);
}

/**
 * Locks the house bankroll row (serialising all risk decisions so exposure
 * cannot be over-committed by concurrent wagers), gathers the exposure
 * snapshot and evaluates the proposal. Throws a RISK_LIMIT error on rejection.
 */
export async function assertWagerAcceptable(
  tx: Tx,
  gameId: string,
  proposal: WagerProposal,
  opts: { roundId?: string } = {},
): Promise<{ netExposure: number }> {
  const ids = await systemAccountIds(tx);
  const house = await lockAccount(tx, ids.HOUSE_BANKROLL);
  // Sequential: a transaction owns a single connection, which runs one query at a time.
  const settings = await getPlatformSettings(tx);
  const limits = await getGameLimits(tx, gameId);
  const exposureGame = await openExposure(tx, { gameId, excludeRoundId: opts.roundId });
  const exposureTotal = await openExposure(tx, { excludeRoundId: opts.roundId });
  const platform: PlatformLimits = {
    newRoundsEnabled: settings.newRoundsEnabled,
    incidentMessage: settings.incidentMessage,
    maxTotalExposure: settings.maxTotalExposure,
    minHouseReserve: settings.minHouseReserve,
    maxPlayerBalance: settings.maxPlayerBalance,
  };
  const exposure: ExposureSnapshot = {
    houseBalance: house.balance,
    openExposureGame: exposureGame,
    openExposureTotal: exposureTotal,
  };
  const decision = evaluateWager(limits, platform, exposure, proposal);
  if (!decision.accepted) {
    if (decision.reason === 'NEW_ROUNDS_DISABLED' || decision.reason === 'GAME_NOT_ACTIVE') {
      throw errors.gameUnavailable(decision.message);
    }
    throw errors.risk(decision.message, { reason: decision.reason, ...decision.details });
  }
  return { netExposure: decision.netExposure };
}
