import { MfaSettings } from '@/components/account/mfa-settings';
import { StaffMfaPolicy } from '@/components/admin/security-policy';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout, PageHeader } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { requirePermission } from '@/server/auth/current';
import { mfaStatus, staffMfaOverview, staffMfaState } from '@/server/auth/mfa';
import { hasPermission, ROLE_LABELS } from '@/server/auth/rbac';
import type { UserRole } from '@/server/db/schema';

export const metadata = { title: 'Staff security' };

/** Reachable without MFA so staff can set it up when the policy requires it. */
export default async function AdminSecurityPage() {
  const session = await requirePermission('admin:access', { allowWithoutMfa: true });
  const [state, mine] = await Promise.all([staffMfaState(session), mfaStatus(session.userId)]);
  const canManage = hasPermission(session.role, 'security:manage');
  const staff = canManage ? await staffMfaOverview() : [];
  const verified = session.mfaVerifiedAt !== null;
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Staff security"
        subtitle="Two-factor authentication (TOTP) for your account and, for owners, the policy for all staff. Passwords, password hashes, sessions and MFA secrets are never shown to anyone."
      />
      {!state.satisfied && (
        <Callout tone="warning" className="mb-6" title="Two-factor authentication is required for staff">
          {state.enabled ? 'Verify this session with a code below to use the back office.' : 'Set up two-factor authentication below to use the back office.'}
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Your two-factor authentication" />
          <CardBody>
            <MfaSettings enabled={mine.enabled} sessionVerified={verified} recoveryCodesLeft={mine.recoveryCodesLeft} />
          </CardBody>
        </Card>
        {canManage && (
          <Card>
            <CardHeader
              title="Staff policy"
              subtitle={state.required ? 'MFA is required for every staff session.' : 'MFA is optional for staff.'}
              actions={<StaffMfaPolicy required={state.required} canEnable={mine.enabled && verified} />}
            />
            <CardBody>
              {!state.required && !(mine.enabled && verified) && (
                <p className="mb-3 text-xs text-ink-400">Turn on MFA for your own account, and sign in with it, before requiring it for staff.</p>
              )}
              <Table>
                <thead>
                  <tr>
                    <Th>Staff account</Th>
                    <Th>Role</Th>
                    <Th>MFA</Th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <Tr key={s.id}>
                      <Td>{s.username}</Td>
                      <Td className="text-xs">{ROLE_LABELS[s.role as UserRole] ?? s.role}</Td>
                      <Td>{s.enabled ? <Badge tone="positive">on</Badge> : <Badge tone="warning">off</Badge>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
