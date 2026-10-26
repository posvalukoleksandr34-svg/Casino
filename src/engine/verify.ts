/**
 * Independent outcome re-computation for the fairness verifier. Runs in the
 * browser with the same code the server uses, from inputs the player can
 * see: the revealed server seed, the client seed, the nonce and the game
 * parameters chosen for the round.
 */
import { drawCrashPoint } from './games/crash';
import { DICE_OUTCOMES } from './games/dice';
import { MINES_TILES } from './games/mines';
import { pocketColor } from './games/roulette/rules';
import { createRandomStream, hashServerSeed, isValidClientSeed, shuffle, type FairnessInput } from './rng/provably-fair';

export interface VerificationResult {
  serverSeedHash: string;
  outcome: Record<string, unknown>;
  description: string;
}

export type VerifyParams = Record<string, unknown>;

type Verifier = (input: FairnessInput, params: VerifyParams) => { outcome: Record<string, unknown>; description: string };

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
