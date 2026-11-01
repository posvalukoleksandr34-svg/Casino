/**
 * Four-eyes approval for sensitive staff operations.
 *
 *   ledger.grant                grants above GRANT_APPROVAL_THRESHOLD   (ledger:grant, owners)
 *   ledger.adjustment           every balance correction                (ledger:adjust)
 *   house.fund                  every house-reserve issuance            (house:fund, owners)
 *   security.staff_mfa_disable  switching off the staff MFA requirement (security:manage, owners)
 *
 * One authorised staff member requests (reason, target, parameters); a second,
 * different one with the same permission approves or rejects. Approval runs
 * the operation in the same transaction as the decision, under a row lock on
 * the request, with a ledger business key derived from the request id — so
 * it executes at most once, even if two approvers click at the same moment.
 * A decided request is immutable (database trigger). Requests expire after
 * APPROVAL_TTL_HOURS. If execution fails (e.g. the balance changed and a debit
 * no longer fits) nothing is posted and the request is closed as FAILED.
 * The operation runs as the requester (whose permission is re-checked), so
 * reconciliation and the admin history attribute it as before; the approval
 * itself is a separate admin action by the approver. Every stage is audited.
 *
 * Routine, low-risk actions (grants up to the threshold, suspensions, game
 * status, sports operations, turning the MFA policy on) stay immediate; the
 * platform kill switch stays immediate because incident response must not wait.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { recordAdminAction } from '../audit/audit';
import { applyStaffMfaPolicy } from '../auth/mfa';
import { hasPermission, type Permission } from '../auth/rbac';
import { getDb, withTransaction, type Executor, type Tx } from '../db/client';
import { adminApprovalRequests, users, type ApprovalAction, type ApprovalStatus, type UserRole } from '../db/schema';
import { AppError, errors } from '../errors';
import { requestFingerprint, runIdempotent, type IdempotentResult } from '../idempotency';
import { executeHouseFunding, type AdminCtx } from './admin-service';
import { executeAdjustment, executeGrant, GRANT_APPROVAL_THRESHOLD, MAX_ADJUSTMENT, MAX_GRANT } from './wallet';

export const APPROVAL_TTL_HOURS = 24;

const UUID = z.uuid();

const SPECS = {
  'ledger.grant': {
    permission: 'ledger:grant',
    targetType: 'user',
    params: z.object({ amount: z.int().gt(GRANT_APPROVAL_THRESHOLD, `Grants up to ${GRANT_APPROVAL_THRESHOLD / 100} chips do not need approval`).max(MAX_GRANT) }).strict(),
  },
  'ledger.adjustment': {
    permission: 'ledger:adjust',
    targetType: 'user',
    params: z
      .object({
        amount: z.int().refine((v) => v !== 0 && Math.abs(v) <= MAX_ADJUSTMENT, 'Amount must be non-zero and within the correction limit'),
        reversesTransactionId: z.int().positive().optional(),
      })
      .strict(),
  },
  'house.fund': { permission: 'house:fund', targetType: 'account', params: z.object({ amount: z.int().positive().max(Number.MAX_SAFE_INTEGER) }).strict() },
  'security.staff_mfa_disable': { permission: 'security:manage', targetType: 'platform', params: z.object({}).strict() },
} as const satisfies Record<ApprovalAction, { permission: Permission; targetType: 'user' | 'account' | 'platform'; params: z.ZodType }>;

export const APPROVAL_ACTIONS = Object.keys(SPECS) as ApprovalAction[];

export function approvalPermission(action: ApprovalAction): Permission {
  return SPECS[action].permission;
}

export const ACTION_LABELS: Record<ApprovalAction, string> = {
  'ledger.grant': 'Large virtual-chip grant',
  'ledger.adjustment': 'Balance correction',
  'house.fund': 'House reserve funding',
  'security.staff_mfa_disable': 'Switch off the staff MFA requirement',
};

async function staffRow(tx: Tx, userId: string) {
  const [row] = await tx.select({ id: users.id, role: users.role, status: users.status }).from(users).where(eq(users.id, userId));
  return row ?? null;
}

function requireAuthorised(row: { role: UserRole; status: string } | null, permission: Permission) {
  if (!row || row.status !== 'ACTIVE' || !hasPermission(row.role, permission)) throw errors.forbidden();
  return row;
}

export interface ApprovalInput {
  action: ApprovalAction;
  /** User id for ledger actions; ignored for house and platform actions. */
  targetId?: string;
  params: Record<string, unknown>;
  reason: string;
}

/** Creates a pending request (202). Idempotent per requester and Idempotency-Key. */
export async function requestApproval(ctx: AdminCtx, input: ApprovalInput, idempotencyKey: string): Promise<IdempotentResult<{ request: ApprovalView }>> {
  const spec = SPECS[input.action];
  if (!spec) throw errors.validation('Unknown action');
  const parsed = spec.params.safeParse(input.params);
  if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Invalid parameters', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500) throw errors.validation('A reason of 5–500 characters is required');
  const targetId = spec.targetType === 'user' ? input.targetId : spec.targetType === 'account' ? 'HOUSE_BANKROLL' : 'staff_mfa_required';
  if (spec.targetType === 'user' && (!targetId || !UUID.safeParse(targetId).success)) throw errors.notFound('User');
  return withTransaction((tx) =>
    runIdempotent(tx, ctx.adminId, idempotencyKey, requestFingerprint('admin:approval', { ...input, reason }), async () => {
      const actor = requireAuthorised(await staffRow(tx, ctx.adminId), spec.permission);
      if (spec.targetType === 'user') {
        const target = await staffRow(tx, targetId!);
        if (!target) throw errors.notFound('User');
        if (target.status === 'DELETED') throw errors.conflict('Deleted accounts cannot be changed');
      }
      const now = new Date();
      const [row] = await tx
        .insert(adminApprovalRequests)
        .values({
          action: input.action,
          targetType: spec.targetType,
          targetId: targetId!,
          params: parsed.data as Record<string, unknown>,
          reason,
          requestedBy: ctx.adminId,
          requestedRole: actor.role,
          requestedAt: now,
          expiresAt: new Date(now.getTime() + APPROVAL_TTL_HOURS * 3600_000),
        })
        .returning();
      await recordAdminAction(tx, {
        ...ctx,
        action: 'approval.requested',
        targetType: 'approval',
        targetId: row!.id,
        reason,
        after: { action: input.action, target: `${spec.targetType}:${targetId}`, params: parsed.data },
      });
      return { status: 202, body: { request: (await viewOne(tx, row!.id))! } };
    }),
  );
}

export type Decision = 'approve' | 'reject' | 'cancel';

export interface DecisionResult {
  request: ApprovalView;
}

/**
 * Approves (and executes), rejects or cancels a pending request. Approval and
 * rejection require a different staff member with the action's permission;
 * cancelling is the requester's own action.
 */
export async function decideApproval(ctx: AdminCtx, id: string, decision: Decision, note: string | undefined): Promise<DecisionResult> {
  if (!UUID.safeParse(id).success) throw errors.notFound('Approval request');
  const trimmed = note?.trim() || undefined;
  if (decision === 'reject' && (!trimmed || trimmed.length < 5)) throw errors.validation('Explain the rejection (at least 5 characters)');
  if (trimmed && trimmed.length > 500) throw errors.validation('The note can be at most 500 characters');
  const outcome = await withTransaction(async (tx) => {
    const [req] = await tx.select().from(adminApprovalRequests).where(eq(adminApprovalRequests.id, id)).for('update');
    if (!req) throw errors.notFound('Approval request');
    if (req.status !== 'PENDING') return { kind: 'closed' as const, status: req.status };
    const now = new Date();
    if (req.expiresAt <= now) {
      await tx.update(adminApprovalRequests).set({ status: 'EXPIRED', decidedAt: now }).where(eq(adminApprovalRequests.id, id));
      await recordAdminAction(tx, { ...ctx, action: 'approval.expired', targetType: 'approval', targetId: id, reason: 'Request expired before a decision' });
      return { kind: 'expired' as const };
    }
    const spec = SPECS[req.action];
    const actor = await staffRow(tx, ctx.adminId);
    if (decision === 'cancel') {
      if (req.requestedBy !== ctx.adminId) throw errors.forbidden('Only the requester can cancel a request');
      requireAuthorised(actor, 'admin:access');
      await tx.update(adminApprovalRequests).set({ status: 'CANCELLED', decidedBy: ctx.adminId, decidedRole: actor!.role, decidedAt: now, decisionNote: trimmed ?? null }).where(eq(adminApprovalRequests.id, id));
      await recordAdminAction(tx, { ...ctx, action: 'approval.cancelled', targetType: 'approval', targetId: id, reason: trimmed ?? 'Cancelled by the requester' });
      return { kind: 'done' as const };
    }
    if (req.requestedBy === ctx.adminId) throw errors.forbidden('You cannot approve or reject your own request: a second authorised staff member must decide it');
    const decider = requireAuthorised(actor, spec.permission);
    if (decision === 'reject') {
      await tx.update(adminApprovalRequests).set({ status: 'REJECTED', decidedBy: ctx.adminId, decidedRole: decider.role, decidedAt: now, decisionNote: trimmed! }).where(eq(adminApprovalRequests.id, id));
      await recordAdminAction(tx, { ...ctx, action: 'approval.rejected', targetType: 'approval', targetId: id, reason: trimmed! });
      return { kind: 'done' as const };
    }
    // Approve: execute in a savepoint so a failed operation leaves no trace but the FAILED record.
    const execCtx: AdminCtx = { adminId: req.requestedBy, ipHash: ctx.ipHash, requestId: ctx.requestId };
    const key = `approval:${req.id}`;
    let result: Record<string, unknown>;
    try {
      result = await tx.transaction(async (sp) => {
        const p = req.params as Record<string, number | undefined>;
        switch (req.action) {
          case 'ledger.grant':
            return (await executeGrant(sp, execCtx, req.targetId, p.amount!, req.reason, key)).body as unknown as Record<string, unknown>;
          case 'ledger.adjustment':
            return (await executeAdjustment(sp, execCtx, req.targetId, p.amount!, req.reason, key, p.reversesTransactionId)).body as unknown as Record<string, unknown>;
          case 'house.fund':
            return (await executeHouseFunding(sp, execCtx, p.amount!, req.reason, key)).body as unknown as Record<string, unknown>;
          case 'security.staff_mfa_disable':
            requireAuthorised(await staffRow(sp, req.requestedBy), 'security:manage');
            return applyStaffMfaPolicy(sp, req.requestedBy, false, req.reason, { ipHash: ctx.ipHash, requestId: ctx.requestId });
        }
      });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      const failure = { error: err.code, message: err.message };
      await tx.update(adminApprovalRequests).set({ status: 'FAILED', decidedBy: ctx.adminId, decidedRole: decider.role, decidedAt: now, decisionNote: trimmed ?? null, result: failure }).where(eq(adminApprovalRequests.id, id));
      await recordAdminAction(tx, { ...ctx, action: 'approval.failed', targetType: 'approval', targetId: id, reason: trimmed ?? 'Approved; execution failed', after: failure });
      return { kind: 'failed' as const, failure };
    }
    await tx.update(adminApprovalRequests).set({ status: 'EXECUTED', decidedBy: ctx.adminId, decidedRole: decider.role, decidedAt: now, decisionNote: trimmed ?? null, result }).where(eq(adminApprovalRequests.id, id));
    await recordAdminAction(tx, { ...ctx, action: 'approval.approved', targetType: 'approval', targetId: id, reason: trimmed ?? 'Approved', after: { action: req.action, result } });
    return { kind: 'done' as const };
  });
  if (outcome.kind === 'closed') throw errors.conflict(`This request is already ${outcome.status.toLowerCase()}`, { status: outcome.status });
  if (outcome.kind === 'expired') throw errors.conflict('This request expired before it was decided. Submit a new one.', { status: 'EXPIRED' });
  if (outcome.kind === 'failed') throw errors.conflict(`Approved, but the operation could not be executed: ${outcome.failure.message}`, { status: 'FAILED', ...outcome.failure });
  return { request: (await viewOne(getDb(), id))! };
}

export interface ApprovalView {
  id: string;
  action: ApprovalAction;
  actionLabel: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  params: Record<string, unknown>;
  reason: string;
  requestedBy: string;
  requesterName: string;
  requestedRole: string;
  requestedAt: Date;
  expiresAt: Date;
  /** PENDING requests past their expiry are reported as EXPIRED. */
  status: ApprovalStatus;
  decidedBy: string | null;
  deciderName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  result: Record<string, unknown> | null;
}

async function queryViews(db: Executor, where: SQL | undefined, limit = 100): Promise<ApprovalView[]> {
  const res = await db.execute<Record<string, unknown>>(sql`
    SELECT r.*, ru.username AS requester_name, du.username AS decider_name,
           CASE WHEN r.target_type = 'user' THEN (SELECT username FROM users t WHERE t.id::text = r.target_id) END AS target_name
      FROM admin_approval_requests r
      JOIN users ru ON ru.id = r.requested_by
      LEFT JOIN users du ON du.id = r.decided_by
     ${where ? sql`WHERE ${where}` : sql``}
     ORDER BY r.requested_at DESC
     LIMIT ${limit}`);
  const now = Date.now();
  return res.rows.map((r) => {
    const status = r.status as ApprovalStatus;
    const expiresAt = new Date(r.expires_at as string);
    return {
      id: r.id as string,
      action: r.action as ApprovalAction,
      actionLabel: ACTION_LABELS[r.action as ApprovalAction],
      targetType: r.target_type as string,
      targetId: r.target_id as string,
      targetName: (r.target_name as string | null) ?? null,
      params: r.params as Record<string, unknown>,
      reason: r.reason as string,
      requestedBy: r.requested_by as string,
      requesterName: r.requester_name as string,
      requestedRole: r.requested_role as string,
      requestedAt: new Date(r.requested_at as string),
      expiresAt,
      status: status === 'PENDING' && expiresAt.getTime() <= now ? 'EXPIRED' : status,
      decidedBy: (r.decided_by as string | null) ?? null,
      deciderName: (r.decider_name as string | null) ?? null,
      decidedAt: r.decided_at ? new Date(r.decided_at as string) : null,
      decisionNote: (r.decision_note as string | null) ?? null,
      result: (r.result as Record<string, unknown> | null) ?? null,
    };
  });
}

async function viewOne(db: Executor, id: string): Promise<ApprovalView | null> {
  return (await queryViews(db, sql`r.id = ${id}`, 1))[0] ?? null;
}

/** Requests the viewer may decide or has made, newest first. */
export async function listApprovals(viewer: { userId: string; role: UserRole }, opts: { status?: 'open' | 'closed' } = {}) {
  const visible = APPROVAL_ACTIONS.filter((a) => hasPermission(viewer.role, SPECS[a].permission));
  const scope = sql`(r.action IN (${sql.join(visible.length ? visible.map((a) => sql`${a}`) : [sql`''`], sql`, `)}) OR r.requested_by = ${viewer.userId})`;
  const filter = opts.status === 'open' ? sql` AND r.status = 'PENDING' AND r.expires_at > now()` : opts.status === 'closed' ? sql` AND (r.status <> 'PENDING' OR r.expires_at <= now())` : sql``;
  const rows = await queryViews(getDb(), sql`${scope}${filter}`, 200);
  return rows.map((r) => ({
    ...r,
    canDecide: r.status === 'PENDING' && r.requestedBy !== viewer.userId && hasPermission(viewer.role, SPECS[r.action].permission),
    canCancel: r.status === 'PENDING' && r.requestedBy === viewer.userId,
  }));
}

/** Pending requests the viewer could decide (for the navigation badge). */
export async function pendingApprovalCount(viewer: { userId: string; role: UserRole }): Promise<number> {
  const visible = APPROVAL_ACTIONS.filter((a) => hasPermission(viewer.role, SPECS[a].permission));
  if (!visible.length) return 0;
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(adminApprovalRequests)
    .where(
      and(
        eq(adminApprovalRequests.status, 'PENDING'),
        sql`${adminApprovalRequests.expiresAt} > now()`,
        sql`${adminApprovalRequests.requestedBy} <> ${viewer.userId}`,
        sql`${adminApprovalRequests.action} IN (${sql.join(visible.map((a) => sql`${a}`), sql`, `)})`,
      ),
    );
  return row?.n ?? 0;
}

/** Requests concerning one target (shown on the user page). */
export async function approvalsForTarget(targetType: 'user', targetId: string) {
  return queryViews(getDb(), sql`r.target_type = ${targetType} AND r.target_id = ${targetId}`, 20);
}

