/**
 * Player details collected after e-mail verification: legal first and last
 * name, date of birth, country of residence and a phone number. New accounts
 * must complete this once before using the product (enforced by the request
 * handler and page guards via SessionUser.onboardingPending); grandfathered
 * accounts may add or edit the same details from Settings.
 *
 * The phone number is normalised to E.164 with libphonenumber-js and stored
 * unverified (phone_verified_at stays NULL: there is no SMS challenge). Names,
 * birth dates and phone numbers never go into audit metadata or logs; audit
 * records name the fields that changed, not their values.
 */
import { eq } from 'drizzle-orm';
import { parsePhoneNumberWithError, type CountryCode } from 'libphonenumber-js/max';
import { z } from 'zod';
import { dateOfBirthProblem, nameProblem, normaliseName, parseCalendarDate, utcToday } from '@/lib/account-policy';
import { audit } from '../audit/audit';
import { getDb, withTransaction } from '../db/client';
import { users } from '../db/schema';
import { AppError, errors } from '../errors';
import { countryName, isPhoneRegion, isResidenceCountry } from './countries';
import { profileSchema } from './profile';

const nameField = (label: string) =>
  z
    .string()
    .max(200)
    .transform((s, ctx) => {
      const problem = nameProblem(s, label);
      if (problem) {
        ctx.addIssue({ code: 'custom', message: problem });
        return z.NEVER;
      }
      return normaliseName(s);
    });

const dateOfBirthField = z
  .string()
  .max(10)
  .refine((s) => !dateOfBirthProblem(s, utcToday()), { error: (iss) => dateOfBirthProblem(String(iss.input), utcToday()) ?? 'Enter a valid date of birth' });

const countryField = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isResidenceCountry, 'Choose your country of residence from the list');

const phoneFields = {
  phoneRegion: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isPhoneRegion, 'Choose the country of your phone number'),
  phoneNumber: z.string().trim().min(1, 'Enter your phone number').max(40),
};

export const onboardingSchema = z
  .object({
    firstName: nameField('first name'),
    lastName: nameField('last name'),
    dateOfBirth: dateOfBirthField,
    countryCode: countryField,
    ...phoneFields,
    displayName: profileSchema.shape.displayName,
    avatar: profileSchema.shape.avatar,
  })
  .strict();
export type OnboardingInput = z.input<typeof onboardingSchema>;

/** Settings: every field optional; date of birth only when none is stored yet. */
export const detailsSchema = z
  .object({
    firstName: nameField('first name').optional(),
    lastName: nameField('last name').optional(),
    dateOfBirth: dateOfBirthField.optional(),
    countryCode: countryField.optional(),
    phoneRegion: phoneFields.phoneRegion.optional(),
    phoneNumber: phoneFields.phoneNumber.optional(),
  })
  .strict()
  .refine((d) => (d.phoneRegion === undefined) === (d.phoneNumber === undefined), { message: 'Give the phone country and number together', path: ['phoneNumber'] });
export type DetailsInput = z.input<typeof detailsSchema>;

/** E.164 for a national or international number; validation errors name the field. */
export function normalisePhone(region: string, number: string): string {
  const fail = () => errors.validation('Enter a valid phone number for the selected country', { issues: [{ path: 'phoneNumber', message: 'Enter a valid phone number for the selected country' }] });
  if (!/^[0-9+()\-.\s/]{3,40}$/.test(number)) throw fail();
  try {
    const parsed = parsePhoneNumberWithError(number, { defaultCountry: region as CountryCode });
    if (!parsed.isValid()) throw fail();
    return parsed.number;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw fail();
  }
}

export function formatPhone(e164: string | null): string | null {
  if (!e164) return null;
  try {
    return parsePhoneNumberWithError(e164).formatInternational();
  } catch {
    return e164;
  }
}

interface Meta {
  ipHash: string | null;
  requestId?: string | null;
}

/**
 * Stores the onboarding details and marks onboarding complete, in one
 * transaction. Only for verified accounts with a pending onboarding; the
 * display name and avatar use the existing profile rules.
 */
export async function completeOnboarding(userId: string, raw: unknown, meta: Meta): Promise<{ completedAt: Date }> {
  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) throw errors.validation('Check the highlighted fields', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  const input = parsed.data;
  const phone = normalisePhone(input.phoneRegion, input.phoneNumber);
  return withTransaction(async (tx) => {
    const [user] = await tx
      .select({ status: users.status, verified: users.emailVerifiedAt, required: users.onboardingRequired, completedAt: users.onboardingCompletedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user || user.status !== 'ACTIVE' || !user.verified) throw errors.forbidden();
    if (!user.required || user.completedAt) throw errors.conflict('Your profile is already complete.', { reason: 'already_complete' });
    const now = new Date();
    await tx
      .update(users)
      .set({
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        countryCode: input.countryCode,
        phoneE164: phone,
        phoneVerifiedAt: null,
        ...(input.displayName !== undefined ? { displayName: input.displayName || null } : {}),
        ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
        onboardingCompletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
    await audit(tx, {
      actorId: userId,
      actorType: 'USER',
      action: 'user.onboarding_completed',
      resourceType: 'user',
      resourceId: userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId ?? null,
      metadata: { fields: ['firstName', 'lastName', 'dateOfBirth', 'countryCode', 'phone', ...(input.displayName ? ['displayName'] : []), ...(input.avatar ? ['avatar'] : [])] },
    });
    return { completedAt: now };
  });
}

/** Edits the player's details from Settings. Changing the phone number clears any verification. */
export async function updateAccountDetails(userId: string, raw: unknown, meta: Meta): Promise<AccountDetails> {
  const parsed = detailsSchema.safeParse(raw);
  if (!parsed.success) throw errors.validation('Check the highlighted fields', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  const input = parsed.data;
  const phone = input.phoneRegion && input.phoneNumber ? normalisePhone(input.phoneRegion, input.phoneNumber) : undefined;
  await withTransaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!before || before.status !== 'ACTIVE') throw errors.forbidden();
    if (input.dateOfBirth !== undefined && before.dateOfBirth && input.dateOfBirth !== before.dateOfBirth) {
      throw errors.validation('Your date of birth is already on record. Contact support if it is wrong.', { issues: [{ path: 'dateOfBirth', message: 'Already on record — contact support to correct it' }] });
    }
    const changes: Partial<typeof users.$inferInsert> = {};
    if (input.firstName !== undefined && input.firstName !== before.firstName) changes.firstName = input.firstName;
    if (input.lastName !== undefined && input.lastName !== before.lastName) changes.lastName = input.lastName;
    if (input.dateOfBirth !== undefined && !before.dateOfBirth) changes.dateOfBirth = input.dateOfBirth;
    if (input.countryCode !== undefined && input.countryCode !== before.countryCode) changes.countryCode = input.countryCode;
    if (phone !== undefined && phone !== before.phoneE164) {
      changes.phoneE164 = phone;
      changes.phoneVerifiedAt = null;
    }
    const fields = Object.keys(changes).filter((k) => k !== 'phoneVerifiedAt').map((k) => (k === 'phoneE164' ? 'phone' : k));
    if (!fields.length) return;
    await tx.update(users).set({ ...changes, updatedAt: new Date() }).where(eq(users.id, userId));
    await audit(tx, { actorId: userId, actorType: 'USER', action: 'user.details_updated', resourceType: 'user', resourceId: userId, ipHash: meta.ipHash, requestId: meta.requestId ?? null, metadata: { fields } });
  });
  return accountDetails(userId);
}

export interface AccountDetails {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  countryCode: string | null;
  countryName: string | null;
  phoneE164: string | null;
  phoneDisplay: string | null;
  phoneVerified: boolean;
  emailVerifiedAt: Date | null;
  emailVerificationMethod: string | null;
  onboardingRequired: boolean;
  onboardingCompletedAt: Date | null;
}

export async function accountDetails(userId: string): Promise<AccountDetails> {
  const [u] = await getDb()
    .select({
      firstName: users.firstName,
      lastName: users.lastName,
      dateOfBirth: users.dateOfBirth,
      countryCode: users.countryCode,
      phoneE164: users.phoneE164,
      phoneVerifiedAt: users.phoneVerifiedAt,
      emailVerifiedAt: users.emailVerifiedAt,
      emailVerificationMethod: users.emailVerificationMethod,
      onboardingRequired: users.onboardingRequired,
      onboardingCompletedAt: users.onboardingCompletedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!u) throw errors.notFound('User');
  return {
    firstName: u.firstName,
    lastName: u.lastName,
    dateOfBirth: u.dateOfBirth,
    countryCode: u.countryCode,
    countryName: countryName(u.countryCode),
    phoneE164: u.phoneE164,
    phoneDisplay: formatPhone(u.phoneE164),
    phoneVerified: u.phoneVerifiedAt !== null,
    emailVerifiedAt: u.emailVerifiedAt,
    emailVerificationMethod: u.emailVerificationMethod,
    onboardingRequired: u.onboardingRequired,
    onboardingCompletedAt: u.onboardingCompletedAt,
  };
}

/** Whether a stored date of birth still satisfies the minimum age today (display helper). */
export function isValidStoredDate(value: string | null): boolean {
  return value !== null && parseCalendarDate(value) !== null;
}
