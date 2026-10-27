/**
 * First-owner provisioning, run by an operator from the command line
 * (scripts/provision-owner.ts) with direct database access. It never creates
 * accounts or sets passwords: the owner registers normally through the site
 * first, then this promotes that existing, active account. It refuses when an
 * active owner already exists (further owners are appointed by an owner in
 * the back office) unless break-glass recovery is requested explicitly.
 * Every use is written to the audit log as a SYSTEM action.
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction } from '../db/client';
import { users } from '../db/schema';
import { audit } from '../audit/audit';
import { revokeAllSessions } from '../auth/sessions';
import { AppError } from '../errors';

export const provisionInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  reason: z.string().trim().min(5, 'A reason of at least 5 characters is required').max(500),
  /** Break-glass: promote even though an active owner exists (e.g. every owner lost access). */
  allowAdditional: z.boolean().default(false),
});

export async function provisionOwner(raw: z.input<typeof provisionInput>) {
  const input = provisionInput.parse(raw);
  return withTransaction(async (tx) => {
    // Lock every owner row (id order) so two provisioning runs cannot both see "no owner".
    const owners = await tx.execute<{ id: string; status: string }>(sql`SELECT id, status FROM users WHERE role = 'OWNER' ORDER BY id FOR UPDATE`);
    const activeOwners = owners.rows.filter((o) => o.status === 'ACTIVE').length;
    const [target] = await tx
      .select({ id: users.id, role: users.role, status: users.status, hasPassword: sql<boolean>`${users.passwordHash} IS NOT NULL` })
      .from(users)
      .where(eq(users.email, input.email))
      .for('update');
    if (!target) throw new AppError('NOT_FOUND', 'No account with that e-mail address. Register it through the site first.');
    if (target.status !== 'ACTIVE' || !target.hasPassword) throw new AppError('CONFLICT', 'The account must be active and able to sign in.');
    if (target.role === 'OWNER') throw new AppError('CONFLICT', 'The account is already an owner.');
    if (activeOwners > 0 && !input.allowAdditional) {
      throw new AppError('CONFLICT', 'An active owner already exists. Owners appoint further owners in the back office; use --break-glass only for recovery.');
    }
    await tx.update(users).set({ role: 'OWNER', updatedAt: new Date() }).where(eq(users.id, target.id));
    const revoked = await revokeAllSessions(tx, target.id); // sign in again with the new role
    await audit(tx, {
      actorType: 'SYSTEM',
      action: 'owner.provisioned',
      resourceType: 'user',
      resourceId: target.id,
      before: { role: target.role },
      after: { role: 'OWNER', sessionsRevoked: revoked },
      reason: input.reason,
      metadata: { via: 'cli', breakGlass: activeOwners > 0, activeOwnersBefore: activeOwners },
    });
    return { userId: target.id, previousRole: target.role, breakGlass: activeOwners > 0 };
  });
}
