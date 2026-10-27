'use client';

import { useState } from 'react';
import { parseChips } from '@/engine/money';
import { Field, Input, Select } from '../ui/form';
import { ReasonedAction } from './reasoned-action';

const ROLE_LABELS: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', SUPPORT: 'Moderator', RISK_MANAGER: 'Risk manager', AUDITOR: 'Auditor', PLAYER: 'Player' };

function chipsOrThrow(text: string): number {
  let minor: number;
  try {
    minor = parseChips(text);
  } catch {
    throw new Error('Enter an amount in chips, e.g. 250 or 12.50');
  }
  if (minor <= 0) throw new Error('The amount must be greater than zero');
  return minor;
}

/**
 * Account actions the viewer may take on this account, as computed by the
 * server (userDetail().allowed). Each one is re-authorised by its API route
 * and service, so hiding a button is never the only protection.
 */
export function UserActions({
  userId,
  status,
  role,
  allowed,
  maxGrantChips,
}: {
  userId: string;
  status: string;
  role: string;
  allowed: { changeStatus: boolean; revokeSessions: boolean; roles: string[]; grant: boolean; adjust: boolean };
  maxGrantChips: number;
}) {
  const [newRole, setNewRole] = useState(allowed.roles.find((r) => r !== role) ?? role);
  const [amount, setAmount] = useState('');
  const [grant, setGrant] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [ref, setRef] = useState('');
  return (
    <div className="flex flex-wrap gap-2">
      {allowed.changeStatus && (
        <ReasonedAction
          label={status === 'SUSPENDED' ? 'Reinstate' : 'Suspend'}
          title={status === 'SUSPENDED' ? 'Reinstate account' : 'Suspend account'}
          description={
            status === 'SUSPENDED'
              ? 'The account can sign in and play again.'
              : 'Every session is revoked immediately. The account cannot sign in, start rounds, place predictions or claim chips until reinstated. Balances and history are unchanged.'
          }
          variant={status === 'SUSPENDED' ? 'secondary' : 'danger'}
          path={`/api/admin/users/${userId}/status`}
          body={(reason) => ({ status: status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED', reason })}
        />
      )}
      {allowed.revokeSessions && status === 'ACTIVE' && (
        <ReasonedAction
          label="Sign out everywhere"
          title="Sign out everywhere"
          description="Revokes every session of this account (for example after a suspected compromise). The account stays active."
          method="DELETE"
          path={`/api/admin/users/${userId}/sessions`}
          body={(reason) => ({ reason })}
        />
      )}
      {allowed.roles.length > 1 && (
        <ReasonedAction
          label="Change role"
          title="Change role"
          description="The account is signed out so the new permissions apply from its next sign-in. Only owners can grant or remove the admin and owner roles."
          path={`/api/admin/users/${userId}/role`}
          body={(reason) => {
            if (newRole === role) throw new Error('Choose a different role');
            return { role: newRole, reason };
          }}
          confirm={newRole === 'OWNER' || newRole === 'ADMIN' ? `I understand this gives ${ROLE_LABELS[newRole]} permissions to this account.` : undefined}
        >
          <Field label="New role">
            {(p) => (
              <Select {...p} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {allowed.roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                    {r === role ? ' (current)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </ReasonedAction>
      )}
      {allowed.grant && (
        <ReasonedAction
          label="Grant test chips"
          title="Grant virtual test chips"
          description={`Posts a CHIP_GRANT ledger transaction (promotions → this wallet). Chips are virtual and have no monetary value. Up to ${maxGrantChips.toLocaleString('en-US')} chips per grant; the balance cap still applies. The player sees the grant and its reason in their history.`}
          path={`/api/admin/users/${userId}/grant`}
          idempotent
          body={(reason) => ({ amount: chipsOrThrow(grant), reason })}
        >
          <Field label="Amount (chips)">{(p) => <Input {...p} inputMode="decimal" value={grant} onChange={(e) => setGrant(e.target.value)} placeholder="e.g. 1000" />}</Field>
        </ReasonedAction>
      )}
      {allowed.adjust && (
        <ReasonedAction
          label="Balance correction"
          title="Compensating balance correction"
          description="Posts a new ADJUSTMENT ledger transaction. Existing entries are never edited and a debit can never take the balance below zero. The player sees this correction and its reason in their transaction history."
          path={`/api/admin/users/${userId}/adjust`}
          idempotent
          body={(reason) => {
            const minor = chipsOrThrow(amount);
            return { amount: direction === 'credit' ? minor : -minor, reason, ...(ref ? { reversesTransactionId: Number(ref) } : {}) };
          }}
        >
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="Direction">
              {(p) => (
                <Select {...p} value={direction} onChange={(e) => setDirection(e.target.value as 'credit' | 'debit')}>
                  <option value="credit">Credit</option>
                  <option value="debit">Debit</option>
                </Select>
              )}
            </Field>
            <Field label="Amount (chips)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          </div>
          <Field label="Corrects transaction # (optional)">{(p) => <Input {...p} inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value.replace(/\D/g, ''))} />}</Field>
        </ReasonedAction>
      )}
    </div>
  );
}
