'use client';

import { useState } from 'react';
import { formatChips, parseChips } from '@/engine/money';
import { Field, Input, Toggle } from '../ui/form';
import { ReasonedAction } from './reasoned-action';

interface Settings {
  newRoundsEnabled: boolean;
  incidentMessage: string | null;
  maxTotalExposure: number;
  minHouseReserve: number;
  maxPlayerBalance: number;
  signupBonus: number;
  dailyBonus: number;
  dailyBonusMaxBalance: number;
  anomalyZThreshold: number;
}

export function KillSwitch({ settings }: { settings: Settings }) {
  const [message, setMessage] = useState(settings.incidentMessage ?? '');
  const enabling = !settings.newRoundsEnabled;
  return (
    <ReasonedAction
      label={enabling ? 'Resume new rounds' : 'Stop all new rounds'}
      title={enabling ? 'Resume new rounds' : 'Engage kill switch'}
      description={enabling ? 'Players will be able to start rounds again.' : 'Blocks every new round on every game immediately. Open rounds can still be completed and nothing is cancelled.'}
      variant={enabling ? 'primary' : 'danger'}
      size="md"
      method="PATCH"
      path="/api/admin/platform"
      body={(reason) => ({ patch: { newRoundsEnabled: enabling, incidentMessage: enabling ? null : message || null }, reason })}
    >
      {!enabling && <Field label="Banner shown to players (optional)">{(p) => <Input {...p} value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} />}</Field>}
    </ReasonedAction>
  );
}

const MONEY: [keyof Settings, string][] = [
  ['maxTotalExposure', 'Max total open exposure'],
  ['minHouseReserve', 'Minimum house reserve'],
  ['maxPlayerBalance', 'Max player balance'],
  ['signupBonus', 'Signup bonus'],
  ['dailyBonus', 'Daily bonus'],
  ['dailyBonusMaxBalance', 'Daily bonus eligibility ceiling'],
];

export function PlatformLimitsEditor({ settings }: { settings: Settings }) {
  const [v, setV] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(MONEY.map(([k]) => [k, formatChips(settings[k] as number).replace(/,/g, '')])),
    anomalyZThreshold: String(settings.anomalyZThreshold),
  }));
  return (
    <ReasonedAction
      label="Edit platform limits"
      title="Edit platform limits"
      size="md"
      method="PATCH"
      path="/api/admin/platform"
      body={(reason) => {
        try {
          const patch: Record<string, number> = Object.fromEntries(MONEY.map(([k]) => [k, parseChips(v[k]!)]));
          patch.anomalyZThreshold = Number(v.anomalyZThreshold);
          return { patch, reason };
        } catch {
          return null;
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {MONEY.map(([k, label]) => (
          <Field key={k} label={`${label} (chips)`}>
            {(p) => <Input {...p} inputMode="decimal" value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} />}
          </Field>
        ))}
        <Field label="Anomaly alert threshold (σ)">{(p) => <Input {...p} inputMode="decimal" value={v.anomalyZThreshold} onChange={(e) => setV((s) => ({ ...s, anomalyZThreshold: e.target.value }))} />}</Field>
      </div>
    </ReasonedAction>
  );
}

export function FundHouse() {
  const [amount, setAmount] = useState('');
  return (
    <ReasonedAction
      label="Fund house reserve"
      title="Fund house reserve (virtual)"
      description="Issues virtual chips from the ISSUANCE account to the house bankroll. Recorded as a HOUSE_FUNDING ledger transaction."
      size="md"
      idempotent
      path="/api/admin/house/fund"
      body={(reason) => {
        try {
          const minor = parseChips(amount);
          return minor > 0 ? { amount: minor, reason } : null;
        } catch {
          return null;
        }
      }}
    >
      <Field label="Amount (chips)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
    </ReasonedAction>
  );
}

export function ReadOnlyToggle({ label, checked }: { label: string; checked: boolean }) {
  return <Toggle label={label} checked={checked} onChange={() => undefined} disabled />;
}
