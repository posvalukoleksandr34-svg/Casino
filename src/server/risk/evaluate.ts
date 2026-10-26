/**
 * Pure risk evaluation. Given the current exposure picture and a proposed
 * wager, decide whether the house can accept it. This function never looks at
 * who the player is, their history or previous outcomes, and it never alters
 * probabilities or payouts: it can only accept or reject a wager *before* the
 * outcome is drawn.
 *
 * Definitions (minor units):
 *   net exposure of a round      = maxPayout − stake   (largest possible house loss)
 *   open exposure (game / total) = Σ net exposure of OPEN rounds, excluding this one
 *   worst-case house balance     = houseBalance − openExposureTotal − netExposure
 * Because every OPEN round's stake is held in escrow and moves to the house
 * at settlement, the house balance after all open rounds settle is at least
 * the worst-case value above, so settlement can never fail for lack of funds
 * while the reserve check holds.
 */

export interface GameLimits {
  minStake: number;
  maxStake: number;
  maxPayoutPerRound: number;
  maxGameExposure: number;
}

export interface PlatformLimits {
  newRoundsEnabled: boolean;
  incidentMessage: string | null;
  maxTotalExposure: number;
  minHouseReserve: number;
  maxPlayerBalance: number;
}

export interface ExposureSnapshot {
  houseBalance: number;
  openExposureGame: number;
  openExposureTotal: number;
}

export interface WagerProposal {
  /** True when opening a new round; false for an additional wager inside an open round. */
  newRound: boolean;
  gameStatus: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  /** Stake of the initial wager (min/max stake applies to this). */
  initialStake: number;
  /** Total stake of the round after this wager. */
  roundStake: number;
  /** Max gross payout of the round after this wager. */
  roundMaxPayout: number;
  playerBalance: number;
  /** Amount debited from the player by this wager. */
  stakeDelta: number;
}

export type RiskRejection =
  | 'NEW_ROUNDS_DISABLED'
  | 'GAME_NOT_ACTIVE'
  | 'STAKE_BELOW_MINIMUM'
  | 'STAKE_ABOVE_MAXIMUM'
  | 'MAX_PAYOUT_EXCEEDED'
  | 'GAME_EXPOSURE_EXCEEDED'
  | 'TOTAL_EXPOSURE_EXCEEDED'
  | 'HOUSE_RESERVE_INSUFFICIENT'
  | 'PLAYER_BALANCE_CAP';

export type RiskDecision =
  | { accepted: true; netExposure: number; worstCaseHouseBalance: number }
  | { accepted: false; reason: RiskRejection; message: string; details: Record<string, number | string> };

export function evaluateWager(
  limits: GameLimits,
  platform: PlatformLimits,
  exposure: ExposureSnapshot,
  w: WagerProposal,
): RiskDecision {
  const reject = (reason: RiskRejection, message: string, details: Record<string, number | string> = {}): RiskDecision => ({
    accepted: false,
    reason,
    message,
    details,
  });

  if (w.newRound) {
    if (!platform.newRoundsEnabled) {
      return reject('NEW_ROUNDS_DISABLED', platform.incidentMessage || 'New rounds are temporarily disabled.');
    }
    if (w.gameStatus !== 'ACTIVE') {
      return reject('GAME_NOT_ACTIVE', 'This game is not accepting new rounds right now.');
    }
    if (w.initialStake < limits.minStake) {
      return reject('STAKE_BELOW_MINIMUM', 'Stake is below the table minimum.', { minStake: limits.minStake });
    }
    if (w.initialStake > limits.maxStake) {
      return reject('STAKE_ABOVE_MAXIMUM', 'Stake is above the table maximum.', { maxStake: limits.maxStake });
    }
  }

  if (w.roundMaxPayout > limits.maxPayoutPerRound) {
    return reject('MAX_PAYOUT_EXCEEDED', 'The potential payout of this wager exceeds the per-round limit.', {
      maxPayoutPerRound: limits.maxPayoutPerRound,
      potentialPayout: w.roundMaxPayout,
    });
  }

  const netExposure = Math.max(0, w.roundMaxPayout - w.roundStake);

  if (exposure.openExposureGame + netExposure > limits.maxGameExposure) {
    return reject('GAME_EXPOSURE_EXCEEDED', 'This game has reached its exposure limit; try a smaller wager.', {
      maxGameExposure: limits.maxGameExposure,
    });
  }
  if (exposure.openExposureTotal + netExposure > platform.maxTotalExposure) {
    return reject('TOTAL_EXPOSURE_EXCEEDED', 'The platform has reached its exposure limit; try again shortly.', {
      maxTotalExposure: platform.maxTotalExposure,
    });
  }

  const worstCaseHouseBalance = exposure.houseBalance - exposure.openExposureTotal - netExposure;
  if (worstCaseHouseBalance < platform.minHouseReserve) {
    return reject('HOUSE_RESERVE_INSUFFICIENT', 'The operator reserve cannot cover this wager right now.', {
      minHouseReserve: platform.minHouseReserve,
    });
  }

  const balanceIfMaxWin = w.playerBalance - w.stakeDelta + w.roundMaxPayout;
  if (balanceIfMaxWin > platform.maxPlayerBalance) {
    return reject('PLAYER_BALANCE_CAP', 'This wager could take your balance above the maximum virtual balance.', {
      maxPlayerBalance: platform.maxPlayerBalance,
    });
  }

  return { accepted: true, netExposure, worstCaseHouseBalance };
}
