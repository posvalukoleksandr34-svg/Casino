'use client';

import { useMemo, useState } from 'react';
import { formatChips, parseChips } from '@/engine/money';
import { Field, Input, Select, Textarea } from '../ui/form';
import { Callout } from '../ui/misc';
import { ReasonedAction } from './reasoned-action';

export function GameStatusControl({ gameId, status }: { gameId: string; status: string }) {
  const [next, setNext] = useState(status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
  return (
    <ReasonedAction
      label="Change status"
      title="Change game status"
      description="SUSPENDED stops new rounds (open rounds can still finish). DISABLED also hides the game from the lobby."
      path={`/api/admin/games/${gameId}/status`}
      body={(reason) => ({ status: next, reason })}
      variant={next === 'ACTIVE' ? 'secondary' : 'danger'}
    >
      <Field label="New status">
        {(p) => (
          <Select {...p} value={next} onChange={(e) => setNext(e.target.value)}>
            <option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="DISABLED">DISABLED</option>
          </Select>
        )}
      </Field>
    </ReasonedAction>
  );
}

export function ConfigEditor({ gameId, config }: { gameId: string; config: unknown }) {
  const [text, setText] = useState(JSON.stringify(config, null, 2));
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [text]);
  return (
    <ReasonedAction
      label="Publish new version"
      title="Publish configuration version"
      description="Creates a new immutable version; rounds already played keep a reference to the version they used. The server rejects any configuration without a strictly positive house edge."
      path={`/api/admin/games/${gameId}/config`}
      body={(reason) => (parsed.ok ? { config: parsed.value, reason } : null)}
    >
      <Field label="Configuration (JSON)">{(p) => <Textarea {...p} className="min-h-40 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      {!parsed.ok && <Callout tone="negative">{parsed.error}</Callout>}
    </ReasonedAction>
  );
}

export function LimitsEditor({ gameId, limits }: { gameId: string; limits: { minStake: number; maxStake: number; maxPayoutPerRound: number; maxGameExposure: number } }) {
  const [v, setV] = useState(() => Object.fromEntries(Object.entries(limits).map(([k, n]) => [k, formatChips(n).replace(/,/g, '')])) as Record<keyof typeof limits, string>);
  const fields: [keyof typeof limits, string][] = [
    ['minStake', 'Minimum stake'],
    ['maxStake', 'Maximum stake'],
    ['maxPayoutPerRound', 'Max payout per round'],
    ['maxGameExposure', 'Max open exposure (game)'],
  ];
  return (
    <ReasonedAction
      label="Edit limits"
      title="Edit risk limits"
      description="Limits are checked before a wager is accepted. They never change probabilities or payouts."
      method="PUT"
      path={`/api/admin/games/${gameId}/limits`}
      body={(reason) => {
        try {
          const out = Object.fromEntries(fields.map(([k]) => [k, parseChips(v[k])]));
          return { limits: out, reason };
        } catch {
          return null;
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([k, label]) => (
          <Field key={k} label={`${label} (chips)`}>
            {(p) => <Input {...p} inputMode="decimal" value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} />}
          </Field>
        ))}
      </div>
    </ReasonedAction>
  );
}
