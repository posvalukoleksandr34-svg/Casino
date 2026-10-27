/**
 * Role-based access control. Permissions are granted to roles following
 * least privilege; there is deliberately no permission to edit balances
 * directly or alter settled rounds — corrections go through audited,
 * player-visible compensating ledger transactions.
 *
 * Roles (docs/admin.md has the full matrix):
 *   OWNER         full authority, incl. owner-only operations below
 *   ADMIN         operational management (everything except owner-only)
 *   SUPPORT       "moderator": reads players and suspends/reinstates them
 *   RISK_MANAGER  games, sports, risk limits, voids
 *   AUDITOR       read-only, including the audit log
 *   PLAYER        no back-office access
 *
 * Who may act on whom is decided by rank (canManageUser / assignableRoles),
 * so staff can never act on a peer or a more privileged account, and only an
 * owner can create or remove admins and owners.
 */
import type { UserRole } from '../db/schema';

export const PERMISSIONS = [
  'admin:access',
  'users:read',
  /** See players' e-mail addresses (others see them masked). */
  'users:pii',
  'users:suspend',
  'roles:manage',
  /** Grant or remove the ADMIN and OWNER roles. */
  'roles:manage_admins',
  'rounds:read',
  'rounds:void',
  'audit:read',
  'games:manage',
  'sports:manage',
  'risk:manage',
  'ledger:read',
  'ledger:adjust',
  /** Grant virtual test chips to a player. */
  'ledger:grant',
  'house:fund',
  'analytics:read',
  'system:read',
  'system:operate',
  /** Staff security policy (e.g. require MFA for staff). */
  'security:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const OWNER_ONLY: readonly Permission[] = ['roles:manage_admins', 'ledger:grant', 'house:fund', 'security:manage'];

const STAFF_READ: Permission[] = ['admin:access', 'users:read', 'rounds:read', 'analytics:read', 'system:read', 'ledger:read'];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  PLAYER: new Set(),
  SUPPORT: new Set([...STAFF_READ, 'users:pii', 'users:suspend']),
  RISK_MANAGER: new Set([...STAFF_READ, 'rounds:void', 'games:manage', 'sports:manage', 'risk:manage', 'system:operate']),
  AUDITOR: new Set([...STAFF_READ, 'audit:read']),
  ADMIN: new Set(PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p))),
  OWNER: new Set(PERMISSIONS),
};

export const ROLES: readonly UserRole[] = ['PLAYER', 'SUPPORT', 'RISK_MANAGER', 'AUDITOR', 'ADMIN', 'OWNER'];

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  SUPPORT: 'Moderator',
  RISK_MANAGER: 'Risk manager',
  AUDITOR: 'Auditor',
  PLAYER: 'Player',
};

/** 0 = player, 1 = specialist staff, 2 = admin, 3 = owner. */
export const ROLE_RANK: Record<UserRole, number> = { PLAYER: 0, SUPPORT: 1, RISK_MANAGER: 1, AUDITOR: 1, ADMIN: 2, OWNER: 3 };

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function isStaff(role: UserRole): boolean {
  return hasPermission(role, 'admin:access');
}

/**
 * Whether `actor` may change the status of (or sign out) an account holding
 * `target`: only accounts of a lower rank, except that owners may act on other
 * owners (the last active owner is protected separately).
 */
export function canManageUser(actor: UserRole, target: UserRole): boolean {
  if (actor === 'OWNER') return true;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

/**
 * Roles `actor` may give an account that currently holds `target`. Empty when
 * the actor may not change that account's role at all. The current role is
 * included so a form can show it; the service rejects no-op changes anyway.
 */
export function assignableRoles(actor: UserRole, target: UserRole): UserRole[] {
  if (!hasPermission(actor, 'roles:manage') || !canManageUser(actor, target)) return [];
  if (hasPermission(actor, 'roles:manage_admins')) return [...ROLES];
  return ROLES.filter((r) => ROLE_RANK[r] < ROLE_RANK[actor]);
}

/** Masks an e-mail address for staff without the users:pii permission. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}•••@${domain.replace(/^[^.]+/, (d) => `${d[0]}•••`)}`;
}
