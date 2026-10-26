'use client';

import { useState } from 'react';
import { parseChips } from '@/engine/money';
import { Field, Input, Select } from '../ui/form';
import { ReasonedAction } from './reasoned-action';

export function UserActions({ userId, status, role, can }: { userId: string; status: string; role: string; can: { suspend: boolean; roles: boolean; adjust: boolean } }) {
  const [newRole, setNewRole] = useState(role);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [ref, setRef] = useState('');
  return (
    <div className="flex flex-wrap gap-2">
      {can.suspend && status !== 'DELETED' && (
        <ReasonedAction
          label={status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
          title={status === 'SUSPENDED' ? 'Reactivate account' : 'Suspend account'}
          description={status === 'SUSPENDED' ? 'The player will be able to sign in again.' : 'All sessions are revoked immediately; the player cannot sign in or wager. Balances are unaffected.'}
          variant={status === 'SUSPENDED' ? 'secondary' : 'danger'}
          path={`/api/admin/users/${userId}/status`}
          body={(reason) => ({ status: status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED', reason })}
        />
      )}
      {can.roles && status !== 'DELETED' && (
        <ReasonedAction label="Change role" title="Change role" description="The user is signed out so new privileges apply from their next login." path={`/api/admin/users/${userId}/role`} body={(reason) => ({ role: newRole, reason })}>
          <Field label="Role">
            {(p) => (
              <Select {...p} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {['PLAYER', 'SUPPORT', 'RISK_MANAGER', 'AUDITOR', 'ADMIN'].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </ReasonedAction>
      )}
      {can.adjust && (
        <ReasonedAction
          label="Balance correction"
          title="Compensating balance correction"
          description="Posts a new ADJUSTMENT ledger transaction. Existing entries are never edited. The player sees this correction and its reason in their transaction history."
          path={`/api/admin/users/${userId}/adjust`}
          idempotent
          body={(reason) => {
            let minor: number;
            try {
              minor = parseChips(amount);
            } catch {
              return null;
            }
            if (minor <= 0) return null;
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
