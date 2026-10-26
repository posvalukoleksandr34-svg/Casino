/**
 * Player-facing descriptions, rules and payout tables. Numbers shown here are
 * derived from the engine modules (see src/engine/games) and verified by
 * tests in tests/unit/content.test.ts so documentation cannot drift from code.
 */
import { PAYOUT_ODDS, WINNING_POCKETS, type RouletteBetType } from '@/engine/games/roulette/rules';
import { mines as minesModule, multiplierE4 as minesMultiplier, survivalProbability } from '@/engine/games/mines';
import { survivalAt as crashSurvival } from '@/engine/games/crash';
import { blackjack as blackjackModule, insuranceEdge } from '@/engine/games/blackjack';
import { ESTIMATES, estimateKey } from '@/engine/games/blackjack/estimates';

const minesConfig = minesModule.defaultConfig;
const bjConfig = blackjackModule.defaultConfig;
const bjEstimate = ESTIMATES[estimateKey(bjConfig)];
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const minesCell = (m: number, k: number) =>
  k > 25 - m ? '—' : `${(minesMultiplier(minesConfig, m, k) / 10_000).toLocaleString('en-US', { maximumFractionDigits: 4 })}× (${(survivalProbability(m, k) * 100).toFixed(2)}%)`;

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

/** Standard deviation of the gross return per unit staked, for a bet type (exact from the odds table). */
export function rouletteSd(type: RouletteBetType): number {
  const p = WINNING_POCKETS[type] / 37;
  const m = PAYOUT_ODDS[type] + 1;
  return Math.sqrt(m * m * p - (m * p) ** 2);
}

/** Variance per unit staked of a crash target x (fraction of stake returned is x with p = (1 − h)/x). */
export function crashVariance(x: number, houseEdgeBp = 100): number {
  const p = crashSurvival(Math.round(x * 100), houseEdgeBp);
  return x * x * p * (1 - p);
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
      `Standard deviation per unit staked: straight up ≈ ${rouletteSd('straight').toFixed(2)}; even-money bets ≈ ${rouletteSd('red').toFixed(2)}; dozens/columns ≈ ${rouletteSd('dozen').toFixed(2)}.`,
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
      'Variance per unit staked is m² × p × (1 − p): about 1.00 at 49.5%, 8.82 at 10%, 97.0 at 1%.',
    ],
  },
  mines: {
    id: 'mines',
    name: 'Mines',
    short: 'Reveal safe tiles on a 5×5 grid; cash out any time.',
    description:
      'Choose how many of the 25 tiles hide mines (1–24), then reveal tiles one by one. Each safe tile raises your multiplier; cash out whenever you like or keep going. A mine ends the round. Mine positions are fixed by your provably fair seed when the round starts.',
    rules: [
      'Mines are placed when the round starts by a Fisher–Yates shuffle of the 25 tiles using your seed pair and nonce; they never move afterwards.',
      'After k safe reveals with m mines, the multiplier is 99% × C(25, k) / C(25 − m, k), rounded down to 4 decimals.',
      'You may cash out after at least one safe reveal; the payout is stake × current multiplier, rounded down to 0.01 chip.',
      'Revealing every safe tile cashes out automatically. Multipliers are capped at 1,000×; reaching the cap also cashes out automatically.',
      'An open round never expires: you can leave and resume it later. Seeds cannot be rotated while it is open.',
    ],
    payoutTable: {
      columns: ['Mines', '1 pick', '2 picks', '3 picks', '5 picks', '10 picks'],
      rows: [1, 3, 5, 10, 20, 24].map((m) => [String(m), minesCell(m, 1), minesCell(m, 2), minesCell(m, 3), minesCell(m, 5), minesCell(m, 10)]),
    },
    math: [
      'With m mines, the chance that the first k reveals are all safe is C(25 − m, k) / C(25, k); the multiplier is 0.99 divided by that probability, so cashing out after any fixed number of picks returns 99% on average.',
      'Because your choices only decide when to stop, and the mines are uniformly random, no stopping strategy can return more than 99%: house edge ≥ 1%. Rounding the multiplier down and the 1,000× cap can only lower the return.',
      'Your tile choices do not matter: every unrevealed tile is equally likely to hide a mine.',
    ],
  },
  crash: {
    id: 'crash',
    name: 'Crash',
    short: 'Cash out before the multiplier crashes.',
    description:
      'A multiplier starts at 1.00× and rises continuously. It will crash at a point fixed by your provably fair seed before take-off. Cash out manually at any moment, or set an automatic target. If the crash comes first, the stake is lost.',
    rules: [
      'The crash point is drawn when the round starts: 52 random bits n give crash = max(1.00, ⌊99 / (1 − n/2⁵²)⌋ / 100). It never changes during the round.',
      'The multiplier at t seconds is e^(0.06·t) (2× after ≈11.6 s, 10× after ≈38 s), measured by the server clock.',
      'A manual cash-out pays the multiplier at the moment the server receives it, provided the crash has not happened yet. Network delay works against you, so the automatic target is the precise option.',
      'An automatic target x (1.01×–1,000×) pays x whenever the crash point is at least x, even if you are disconnected.',
      'About 1.98% of rounds crash at take-off (crash point 1.00×), before any cash-out is possible. Multipliers are capped at 1,000×: a round still in flight at the cap cashes out at the cap.',
    ],
    payoutTable: {
      columns: ['Target', 'Win probability', 'Pays', 'RTP'],
      rows: [101, 150, 200, 300, 500, 1000, 10000, 100000].map((x) => [
        `${(x / 100).toFixed(2)}×`,
        `${(crashSurvival(x, 100) * 100).toFixed(4)}%`,
        `${(x / 100).toFixed(2)} × stake`,
        `${(crashSurvival(x, 100) * (x / 100) * 100).toFixed(2)}%`,
      ]),
    },
    math: [
      'For any target x ≥ 1.01, P(crash ≥ x) = 0.99 / x exactly (up to 2⁻⁵² discretisation), so the expected return is x × 0.99/x = 99%: house edge 1% for every target of at least 1.01×, manual or automatic.',
      'P(crash = 1.00×) = 1 − 0.99/1.01 ≈ 1.98%: those rounds end at take-off. Cashing out at exactly 1.00× would therefore return only 98.02%.',
      `Variance per unit staked for target x is x² p (1 − p) with p = 0.99/x: ${crashVariance(2).toFixed(2)} at 2×, ${crashVariance(10).toFixed(1)} at 10×, ${crashVariance(100).toFixed(0)} at 100×.`,
    ],
  },
  blackjack: {
    id: 'blackjack',
    name: 'Blackjack',
    short: 'Beat the dealer without going over 21.',
    description: `Classic blackjack against the dealer, dealt from a freshly shuffled ${bjConfig.decks}-deck shoe every hand — the entire shoe order is fixed by your provably fair seed before the first card. Get closer to 21 than the dealer without going over.`,
    rules: [
      'Cards 2–10 count their face value, J/Q/K count 10, an ace counts 1 or 11. An ace and a ten-value card as your first two cards is a blackjack.',
      `Dealing order: you, dealer (face up), you, dealer (face down). The dealer ${bjConfig.dealerHitsSoft17 ? 'hits' : 'stands on'} soft 17 and draws to 16 or less.`,
      'With an ace or ten showing, the dealer checks for blackjack before you act. If the dealer has blackjack you lose only your original stake (a player blackjack pushes).',
      `Insurance (half your stake) is offered when the dealer shows an ace and pays 2:1 if the dealer has blackjack.`,
      `Double on any first two cards${bjConfig.doubleAfterSplit ? ', also after splitting' : ' (not after splitting)'}: your stake doubles and you receive exactly one more card.`,
      'Split two cards of equal value into separate hands (up to 4 hands). Split aces receive one card each and cannot be split again; an ace and a ten after a split counts 21, not blackjack.',
      'No surrender. Unfinished hands stay open until you complete them.',
      'A 3:2 or 6:5 blackjack payout that is not a whole number of 0.01 chips is rounded down.',
    ],
    payoutTable: {
      columns: ['Outcome', 'Pays', 'Returned per 10 chips'],
      rows: [
        ['Blackjack', `${bjConfig.blackjackPays}`, bjConfig.blackjackPays === '3:2' ? '25' : '22'],
        ['Win', '1:1', '20'],
        ['Push', 'Stake returned', '10'],
        ['Insurance (dealer blackjack)', '2:1', '15 per 5 insured'],
        ['Loss / bust', '—', '0'],
      ],
    },
    math: [
      bjEstimate
        ? `Unlike the other games, the return depends on your decisions. With basic strategy the house edge is estimated at ${pct(bjEstimate.houseEdge, 3)} (95% CI ${pct(bjEstimate.ci95[0])}–${pct(bjEstimate.ci95[1])}), from ${bjEstimate.hands.toLocaleString('en-US')} simulated hands of this exact game code. This is an estimate, not an exact value.`
        : 'The house-edge estimate for these rules has not been produced yet.',
      'Any deviation from basic strategy raises the house edge. Card counting does not help: every hand starts from a new shuffled shoe.',
      `Insurance has a house edge of about ${pct(insuranceEdge(bjConfig.decks))} with a fresh ${bjConfig.decks}-deck shoe: given the dealer's ace, the hole card is a ten with probability ${16 * bjConfig.decks}/${52 * bjConfig.decks - 1} before accounting for your own two cards. Basic strategy never takes it.`,
      bjEstimate ? `Variance per unit of initial stake is about ${bjEstimate.variancePerUnit.toFixed(2)} (doubles and splits make it larger than an even-money bet).` : 'Variance per unit of initial stake is about 1.3.',
    ],
  },
};
