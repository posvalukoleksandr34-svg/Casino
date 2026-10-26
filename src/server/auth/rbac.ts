/**
 * Role-based access control. Permissions are granted to roles following
 * least privilege; there is deliberately no permission to edit balances
 * directly or alter settled rounds — corrections go through audited,
 * player-visible compensating ledger adjustments.
 */
import type { UserRole } from '../db/schema';

export const PERMISSIONS = [
  'admin:access',
  'users:read',
  'users:suspend',
  'roles:manage',
  'rounds:read',
  'rounds:void',
  'audit:read',
  'games:manage',
  'risk:manage',
  'ledger:read',
  'ledger:adjust',
  'house:fund',
  'analytics:read',
  'system:read',
  'system:operate',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF_READ: Permission[] = ['admin:access', 'users:read', 'rounds:read', 'analytics:read', 'system:read', 'ledger:read'];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  PLAYER: new Set(),
  SUPPORT: new Set([...STAFF_READ, 'users:suspend']),
  RISK_MANAGER: new Set([...STAFF_READ, 'rounds:void', 'games:manage', 'risk:manage', 'system:operate']),
  AUDITOR: new Set([...STAFF_READ, 'audit:read']),
  ADMIN: new Set(PERMISSIONS),
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function isStaff(role: UserRole): boolean {
  return hasPermission(role, 'admin:access');
}
