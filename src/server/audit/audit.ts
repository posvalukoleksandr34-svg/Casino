import { sql } from 'drizzle-orm';
import { auditLogs, adminActions } from '../db/schema';
import type { Executor } from '../db/client';

export type ActorType = 'USER' | 'ADMIN' | 'SYSTEM' | 'ANONYMOUS';

export interface AuditEvent {
  actorId?: string | null;
  actorType: ActorType;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipHash?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
  /** Defaults to SUCCESS: most events are written in the transaction of the change they describe. */
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILED';
}

/**
 * Appends an audit record. Audit rows are immutable for the application
 * (DB triggers refuse UPDATE, DELETE and TRUNCATE). The actor's role is read
 * from their account in the same statement, so it is the role they held when
 * the record was written.
 */
export async function audit(db: Executor, event: AuditEvent): Promise<number> {
  const [row] = await db
    .insert(auditLogs)
    .values({
      actorId: event.actorId ?? null,
      actorType: event.actorType,
      action: event.action,
      resourceType: event.resourceType ?? null,
      resourceId: event.resourceId ?? null,
      before: event.before ?? null,
      after: event.after ?? null,
      reason: event.reason ?? null,
      ipHash: event.ipHash ?? null,
      requestId: event.requestId ?? null,
      metadata: event.metadata ?? {},
      outcome: event.outcome ?? 'SUCCESS',
      actorRole: event.actorId ? sql`(SELECT role::text FROM users WHERE id = ${event.actorId})` : null,
    })
    .returning({ id: auditLogs.id });
  return row!.id;
}

export interface AdminActionInput {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
  requestId?: string | null;
}

/**
 * Records a state-changing administrative action: who, when, what, the
 * previous and new values, and the stated reason. Must be called inside the
 * same transaction as the change so the record and the change commit together.
 */
export async function recordAdminAction(db: Executor, input: AdminActionInput): Promise<void> {
  const auditLogId = await audit(db, {
    actorId: input.adminId,
    actorType: 'ADMIN',
    action: input.action,
    resourceType: input.targetType,
    resourceId: input.targetId,
    before: input.before,
    after: input.after,
    reason: input.reason,
    ipHash: input.ipHash ?? null,
    requestId: input.requestId ?? null,
  });
  await db.insert(adminActions).values({
    adminId: input.adminId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    before: input.before ?? null,
    after: input.after ?? null,
    auditLogId,
  });
}
