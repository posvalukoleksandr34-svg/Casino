/**
 * Player profile: optional display name and avatar preset. Only the player
 * can change their own profile; there are no public profiles.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AVATAR_IDS } from '@/lib/avatars';
import { audit } from '../audit/audit';
import { withTransaction } from '../db/client';
import { users } from '../db/schema';
import { errors } from '../errors';

export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,30}[\p{L}\p{N}.]$/u;

export const profileSchema = z
  .object({
    displayName: z
      .string()
      .transform((s) => s.trim().replace(/\s+/g, ' '))
      .refine((s) => s === '' || DISPLAY_NAME_PATTERN.test(s), {
        message: 'Use 2–32 letters, digits, spaces, dots, dashes or underscores, starting and ending with a letter or digit',
      })
      .nullable()
      .optional(),
    avatar: z.enum(AVATAR_IDS).nullable().optional(),
  })
  .strict();
export type ProfileInput = z.infer<typeof profileSchema>;

export interface Profile {
  displayName: string | null;
  avatar: string | null;
}

export async function updateProfile(userId: string, input: ProfileInput, meta: { ipHash?: string | null; requestId?: string | null } = {}): Promise<Profile> {
  return withTransaction(async (tx) => {
    const [before] = await tx.select({ displayName: users.displayName, avatar: users.avatar }).from(users).where(eq(users.id, userId)).for('update');
    if (!before) throw errors.notFound('User');
    const next: Profile = {
      displayName: input.displayName === undefined ? before.displayName : input.displayName || null,
      avatar: input.avatar === undefined ? before.avatar : input.avatar,
    };
    if (next.displayName === before.displayName && next.avatar === before.avatar) return next;
    await tx.update(users).set({ ...next, updatedAt: new Date() }).where(eq(users.id, userId));
    await audit(tx, {
      actorId: userId,
      actorType: 'USER',
      action: 'user.profile_updated',
      resourceType: 'user',
      resourceId: userId,
      before,
      after: next,
      ipHash: meta.ipHash ?? null,
      requestId: meta.requestId ?? null,
    });
    return next;
  });
}
