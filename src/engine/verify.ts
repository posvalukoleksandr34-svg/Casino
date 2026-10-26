/**
 * Independent outcome re-computation for the fairness verifier. Runs in the
 * browser with the same code the server uses, from inputs the player can
 * see: the revealed server seed, the client seed, the nonce and the game
 * parameters chosen for the round.
 */
import { DICE_OUTCOMES } from './games/dice';
import { pocketColor } from './games/roulette/rules';
import { createRandomStream, hashServerSeed, isValidClientSeed, type FairnessInput } from './rng/provably-fair';

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
