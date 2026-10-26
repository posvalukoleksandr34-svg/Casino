import { eq, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client';
import { platformSettings, riskLimits } from '../db/schema';
import { errors } from '../errors';
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
  opts: { roundId?: string; settings?: Awaited<ReturnType<typeof getPlatformSettings>>; limits?: GameLimits } = {},
): Promise<{ netExposure: number }> {
  // Configuration is read before taking the house lock to keep the serialised
  // section short; the lock then makes the exposure snapshot and reserve check
  // consistent with every other concurrent wager.
  const settings = opts.settings ?? (await getPlatformSettings(tx));
  const limits = opts.limits ?? (await getGameLimits(tx, gameId));
  const snap = await tx.execute<{ house_balance: number; exposure_game: number; exposure_total: number }>(
    sql`SELECT house_balance, exposure_game, exposure_total FROM risk_snapshot(${gameId}, ${opts.roundId ?? null}::uuid)`,
  );
  const row = snap.rows[0]!;
  const house = { balance: Number(row.house_balance) };
  const exposureGame = Number(row.exposure_game);
  const exposureTotal = Number(row.exposure_total);
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
