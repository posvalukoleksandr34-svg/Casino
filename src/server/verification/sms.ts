/**
 * SMS delivery behind one small interface, used only for phone verification.
 *
 * No provider ships with Aurovane. With SMS_PROVIDER=disabled (the only
 * configurable value today) no phone challenge is ever created, numbers stay
 * unverified, and the interface says verification is not available. To add a
 * real provider: implement `SmsProvider` in a new file (send one text to one
 * E.164 number, throw on failure with `permanent: true` for rejected
 * numbers), add its name to SMS_PROVIDER in src/server/env.ts, read its
 * credentials from the environment there, and return it from getSmsProvider.
 * Never log the number or the message text.
 */
import { env } from '../env';

export interface SmsProvider {
  /** Short provider name, stored with each challenge. */
  readonly name: string;
  /** Sends one text. Throw on failure; set `permanent: true` when the number itself was refused. */
  send(toE164: string, text: string): Promise<void>;
}

let override: SmsProvider | null | undefined;

/** The configured provider, or null when phone verification is unavailable. */
export function getSmsProvider(): SmsProvider | null {
  if (override !== undefined) return override;
  switch (env().SMS_PROVIDER) {
    case 'disabled':
      return null;
  }
}

/** Tests only: install a provider (null = none; undefined = configuration). */
export function setSmsProviderForTests(p: SmsProvider | null | undefined): void {
  override = p;
}
