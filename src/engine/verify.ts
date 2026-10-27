/**
 * Independent outcome re-computation for the fairness verifier. Runs in the
 * browser with the same code the server uses, from inputs the player can
 * see: the revealed server seed, the client seed, the nonce and the game
 * parameters chosen for the round.
 */
import { label } from './games/blackjack/cards';
import { drawCrashPoint } from './games/crash';
import { DICE_OUTCOMES } from './games/dice';
import { cardLabel, hilo, HILO_CARDS, sequenceLength } from './games/hilo';
import { drawKeno } from './games/keno';
import { MINES_TILES } from './games/mines';
import { dropPath, PLINKO_ROWS } from './games/plinko';
import { pocketColor } from './games/roulette/rules';
import { createRandomStream, hashServerSeed, isValidClientSeed, shuffle, type FairnessInput } from './rng/provably-fair';

export interface VerificationResult {
  serverSeedHash: string;
  outcome: Record<string, unknown>;
  description: string;
}

export type VerifyParams = Record<string, unknown>;

type Verifier = (input: FairnessInput, params: VerifyParams) => { outcome: Record<string, unknown>; description: string };

/** Cards shown by the blackjack verifier when the number dealt is not given. */
const BLACKJACK_DEFAULT_CARDS = 24;

const verifiers: Record<string, Verifier> = {
  roulette: (input) => {
    const pocket = createRandomStream(input).nextInt(37);
    return { outcome: { pocket, color: pocketColor(pocket) }, description: `Pocket ${pocket} (${pocketColor(pocket)})` };
  },
  dice: (input) => {
    const roll = createRandomStream(input).nextInt(DICE_OUTCOMES);
    return { outcome: { roll, display: (roll / 100).toFixed(2) }, description: `Roll ${(roll / 100).toFixed(2)}` };
  },
  crash: (input, params) => {
    const edge = params.houseEdgeBp === undefined ? 100 : Number(params.houseEdgeBp);
    const crashE2 = drawCrashPoint(createRandomStream(input), edge);
    return { outcome: { crashPoint: (crashE2 / 100).toFixed(2), crashE2 }, description: `Crash at ${(crashE2 / 100).toFixed(2)}×` };
  },
  mines: (input, params) => {
    const count = Number(params.mines);
    if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error('Number of mines must be between 1 and 24');
    const order = shuffle(Array.from({ length: MINES_TILES }, (_, i) => i), createRandomStream(input));
    const positions = order.slice(0, count).sort((a, b) => a - b);
    const grid = Array.from({ length: 5 }, (_, r) =>
      Array.from({ length: 5 }, (_, c) => (positions.includes(r * 5 + c) ? '✹' : '·')).join(' '),
    ).join('\n');
    return { outcome: { mines: positions, grid }, description: `Mines at ${positions.join(', ')}` };
  },
  limbo: (input, params) => {
    const edge = params.houseEdgeBp === undefined ? 100 : Number(params.houseEdgeBp);
    const resultE2 = drawCrashPoint(createRandomStream(input), edge);
    return { outcome: { result: (resultE2 / 100).toFixed(2), resultE2 }, description: `Result ${(resultE2 / 100).toFixed(2)}×` };
  },
  keno: (input) => {
    const drawn = drawKeno(createRandomStream(input));
    return { outcome: { drawn }, description: `Drawn: ${drawn.join(', ')}` };
  },
  plinko: (input, params) => {
    const rows = Number(params.rows);
    if (!(PLINKO_ROWS as readonly number[]).includes(rows)) throw new Error(`Rows must be one of ${PLINKO_ROWS.join(', ')}`);
    const path = dropPath(rows, createRandomStream(input));
    const slot = path.reduce((a, b) => a + b, 0);
    return {
      outcome: { path: path.map((b) => (b ? 'R' : 'L')).join(''), slot },
      description: `Path ${path.map((b) => (b ? 'R' : 'L')).join('')} → slot ${slot} of 0–${rows}`,
    };
  },
  hilo: (input, params) => {
    // Every card the round could use, in order (the defaults' bound unless a count is given).
    const max = sequenceLength(hilo.defaultConfig);
    const requested = params.cards === undefined ? max : Number(params.cards);
    if (!Number.isInteger(requested) || requested < 1 || requested > max) throw new Error(`Cards to show must be between 1 and ${max}`);
    const rng = createRandomStream(input);
    const cards = Array.from({ length: requested }, () => cardLabel(rng.nextInt(HILO_CARDS)));
    return {
      outcome: { cards, order: 'first card, then one card per guess or skip, in the order you made them' },
      description: `Cards begin ${cards.slice(0, 8).join(' ')} …`,
    };
  },
  blackjack: (input, params) => {
    const decks = params.decks === undefined ? 6 : Number(params.decks);
    if (decks !== 6 && decks !== 8) throw new Error('Number of decks must be 6 or 8');
    // Show at least every card the round dealt (a round with splits and many
    // small cards can use more than the default prefix).
    const requested = params.cards === undefined ? BLACKJACK_DEFAULT_CARDS : Number(params.cards);
    if (!Number.isInteger(requested) || requested < 4 || requested > 52 * decks) throw new Error(`Cards to show must be between 4 and ${52 * decks}`);
    const shoe = shuffle(Array.from({ length: 52 * decks }, (_, i) => i), createRandomStream(input));
    const cards = shoe.slice(0, requested).map(label);
    return {
      outcome: { firstCards: cards, dealOrder: 'player, dealer up, player, dealer hole, then cards in the order they were requested' },
      description: `Shoe begins ${cards.slice(0, 6).join(' ')} …`,
    };
  },
};

export function registerVerifier(gameId: string, verifier: Verifier): void {
  verifiers[gameId] = verifier;
}

export function verifiableGames(): string[] {
  return Object.keys(verifiers);
}

export function verifyOutcome(gameId: string, input: FairnessInput, params: VerifyParams = {}): VerificationResult {
  const verifier = verifiers[gameId];
  if (!verifier) throw new Error(`no verifier for ${gameId}`);
  if (!isValidClientSeed(input.clientSeed)) throw new Error('Client seed must be 1–64 printable characters without spaces');
  if (!Number.isSafeInteger(input.nonce) || input.nonce < 0) throw new Error('Nonce must be a non-negative integer');
  const { outcome, description } = verifier(input, params);
  return { serverSeedHash: hashServerSeed(input.serverSeed), outcome, description };
}
