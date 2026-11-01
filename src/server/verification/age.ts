/**
 * Age assurance. Today the only signal is the self-declared date of birth,
 * enforced 18+ on the server at onboarding (src/server/users/onboarding.ts).
 * This module is the seam for a qualified third-party age or identity
 * verification provider, should an operator decide one is needed:
 *
 *   1. implement `AgeVerificationProvider` (start a check for a user and
 *      return where to send them; validate the provider's signed callback),
 *   2. add its name to AGE_VERIFICATION_PROVIDER in src/server/env.ts with its
 *      credentials, and return it from `getAgeVerificationProvider`,
 *   3. add the two routes that call `start` and `complete` (behind
 *      `route({ auth: 'user' })`), and call `recordAgeVerification` on success.
 *
 * Nothing here is active until then: no provider is contacted, and no account
 * is ever shown as age-verified without a provider's confirmation.
 */
import { eq } from 'drizzle-orm';
import { audit } from '../audit/audit';
import type { Tx } from '../db/client';
import { users } from '../db/schema';
import { env } from '../env';

export interface AgeVerificationProvider {
  readonly name: string;
  /** Begins a check; the player is sent to `redirectUrl`. `reference` identifies the check at the provider. */
  start(user: { id: string; dateOfBirth: string | null; countryCode: string | null }): Promise<{ redirectUrl: string; reference: string }>;
  /** Validates the provider's callback (signature included) and returns its verdict. */
  complete(payload: unknown): Promise<{ reference: string; userId: string; over18: boolean }>;
}

export type AgeAssurance = 'provider_verified' | 'self_declared' | 'not_provided';

export function getAgeVerificationProvider(): AgeVerificationProvider | null {
  switch (env().AGE_VERIFICATION_PROVIDER) {
    case 'none':
      return null;
  }
}

export function ageAssurance(u: { ageVerifiedAt: Date | null; dateOfBirth: string | null }): AgeAssurance {
  if (u.ageVerifiedAt) return 'provider_verified';
  return u.dateOfBirth ? 'self_declared' : 'not_provided';
}

/** Records a provider's positive result (call only after `complete` validated it). */
export async function recordAgeVerification(tx: Tx, userId: string, provider: string, reference: string): Promise<void> {
  await tx.update(users).set({ ageVerifiedAt: new Date(), ageVerificationProvider: provider, ageVerificationRef: reference.slice(0, 200), updatedAt: new Date() }).where(eq(users.id, userId));
  await audit(tx, { actorType: 'SYSTEM', action: 'user.age_verified', resourceType: 'user', resourceId: userId, metadata: { provider } });
}
