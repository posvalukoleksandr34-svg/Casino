/**
 * Player-facing descriptions, rules and payout tables. Numbers shown here are
 * derived from the engine modules (see src/engine/games) and verified by
 * tests in tests/unit/content.test.ts so documentation cannot drift from code.
 */
import { PAYOUT_ODDS, WINNING_POCKETS, type RouletteBetType } from '@/engine/games/roulette/rules';

export interface PayoutRow {
  bet: string;
  covers: string;
  probability: string;
  pays: string;
  rtp: string;
}

export interface GameContent {
  id: string;
  name: string;
  short: string;
  description: string;
  rules: string[];
  payoutTable?: { columns: string[]; rows: string[][] };
  math: string[];
}

const fmtP = (num: number, den: number) => `${num}/${den} (${((num / den) * 100).toFixed(3)}%)`;

const ROULETTE_LABELS: [RouletteBetType, string, string][] = [
  ['straight', 'Straight up', 'One number (0–36)'],
  ['red', 'Red / Black', '18 numbers'],
  ['odd', 'Odd / Even', '18 numbers'],
  ['low', '1–18 / 19–36', '18 numbers'],
  ['dozen', 'Dozen', '12 numbers'],
  ['column', 'Column', '12 numbers'],
];

export const GAME_CONTENT: Record<string, GameContent> = {
  roulette: {
    id: 'roulette',
    name: 'European Roulette',
    short: 'Single-zero wheel with inside and outside bets.',
    description:
      'A single-zero wheel with 37 pockets. Place chips on numbers, colours, odd/even, high/low, dozens or columns — several bets per spin are allowed. The pocket is drawn on the server from your provably fair seed before any animation plays.',
    rules: [
      'The wheel has 37 pockets: 0 (green) and 1–36 (18 red, 18 black).',
      'You may place several bets per spin; chips on the same position are combined.',
      'Winning bets are paid at the odds below and the original stake is returned with the winnings.',
      'Zero is not red, black, odd, even, low or high, and is in no dozen or column: every outside bet loses on 0. There is no "la partage" or "en prison" rule.',
      'Table minimum and maximum apply to the total stake of a spin; the potential payout of a spin is also capped (see table limits).',
    ],
    payoutTable: {
      columns: ['Bet', 'Covers', 'Win probability', 'Pays', 'RTP'],
      rows: ROULETTE_LABELS.map(([type, label, covers]) => [
        label,
        covers,
        fmtP(WINNING_POCKETS[type], 37),
        `${PAYOUT_ODDS[type]} to 1`,
        `${((WINNING_POCKETS[type] * (PAYOUT_ODDS[type] + 1)) / 37 * 100).toFixed(3)}%`,
      ]),
    },
    math: [
      'For every bet type, P(win) × (odds + 1) = 36/37, so the RTP of every bet — and of any combination of bets — is exactly 97.297% and the house edge is 1/37 = 2.703%.',
      'Example: a 10-chip straight-up bet returns 360 chips with probability 1/37 and 0 otherwise: expected return 360/37 = 9.73 chips, expected loss 0.27 chips.',
      'Standard deviation per unit staked: straight up ≈ 5.84; even-money bets ≈ 1.00; dozens/columns ≈ 1.39.',
    ],
  },
  dice: {
    id: 'dice',
    name: 'Dice',
    short: 'Choose your own odds from 1% to 98%.',
    description:
      'The server rolls a number from 0.00 to 99.99 (10,000 equally likely outcomes). Pick a target and whether you need to roll under or over it. The lower your chance of winning, the higher the multiplier — with the same 1% house edge at every setting.',
    rules: [
      'Roll under: you win if the roll is strictly less than the target. Roll over: you win if it is strictly greater.',
      'Win chance must be between 1.00% and 98.00%.',
      'Multiplier = 99% ÷ win chance, rounded down to 4 decimal places. A winning bet pays stake × multiplier (rounded down to the nearest 0.01 chip), which includes your stake.',
      'A losing bet returns nothing.',
    ],
    payoutTable: {
      columns: ['Win chance', 'Roll under', 'Multiplier', 'RTP'],
      rows: [
        ['98.00%', '98.00', '1.0102×', '98.9996%'],
        ['90.00%', '90.00', '1.1000×', '99.0000%'],
        ['75.00%', '75.00', '1.3200×', '99.0000%'],
        ['49.50%', '49.50', '2.0000×', '99.0000%'],
        ['33.00%', '33.00', '3.0000×', '99.0000%'],
        ['10.00%', '10.00', '9.9000×', '99.0000%'],
        ['1.00%', '1.00', '99.0000×', '99.0000%'],
      ],
    },
    math: [
      'With w winning rolls out of 10,000, P(win) = w/10,000 and the multiplier is m = ⌊0.99 × 10,000 / w × 10⁴⌋ / 10⁴. RTP = P(win) × m ≤ 99.00%, house edge ≥ 1.00%.',
      'Rounding the multiplier down lowers RTP by less than 0.0001 (0.01 percentage points); rounding each payout down to 0.01 chip lowers it by less than 0.01 chip per bet.',
      'Variance per unit staked is m² × p × (1 − p): about 0.98 at 49.5%, 8.8 at 10%, 97 at 1%.',
    ],
  },
};
