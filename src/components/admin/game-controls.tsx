'use client';

import { useState } from 'react';
import { formatChips, parseChips } from '@/engine/money';
import { GAME_STATUS_LABELS } from '../account/labels';
import { Field, Input, Select } from '../ui/form';
import { ReasonedAction } from './reasoned-action';


/**
 * Active / maintenance (no new rounds; open rounds can finish) / disabled
 * (also hidden from the lobby). Pausing a game with open rounds needs an
 * explicit confirmation, which the server requires too.
 */
export function GameStatusControl({ gameId, status, openRounds }: { gameId: string; status: string; openRounds: number }) {
  const [next, setNext] = useState(status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
  const pausing = next !== 'ACTIVE';
  return (
    <ReasonedAction
      label="Change status"
      title="Change game status"
      description="Maintenance stops new rounds; players can still finish open rounds. Disabled also hides the game from the lobby. Status never changes outcomes or payouts."
      path={`/api/admin/games/${gameId}/status`}
      body={(reason) => {
        if (next === status) throw new Error('Choose a different status');
        return { status: next, reason, ...(pausing && openRounds > 0 ? { confirmOpenRounds: true } : {}) };
      }}
      variant={pausing ? 'danger' : 'secondary'}
      confirm={pausing && openRounds > 0 ? `${openRounds} round${openRounds === 1 ? ' is' : 's are'} open. Players can finish ${openRounds === 1 ? 'it' : 'them'}, but nobody can start a new round.` : undefined}
    >
      <Field label="New status">
        {(p) => (
          <Select {...p} value={next} onChange={(e) => setNext(e.target.value)}>
            {['ACTIVE', 'SUSPENDED', 'DISABLED'].map((s) => (
              <option key={s} value={s}>
                {GAME_STATUS_LABELS[s]}
                {s === status ? ' (current)' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </ReasonedAction>
  );
}

/** Re-activates the published reference configuration (the only one the server accepts). */
export function RestoreReferenceConfig({ gameId, reference }: { gameId: string; reference: unknown }) {
  return (
    <ReasonedAction
      label="Restore published configuration"
      title="Restore the published configuration"
      description="Publishes the reference configuration as a new version. The rules, payout tables and RTP shown to players are generated from this configuration."
      path={`/api/admin/games/${gameId}/config`}
      body={(reason) => ({ config: reference, reason })}
    >
      <pre className="max-h-48 overflow-auto rounded-lg bg-ink-900 p-2 text-[11px] text-ink-300">{JSON.stringify(reference, null, 2)}</pre>
    </ReasonedAction>
  );
}

type Limits = { minStake: number; maxStake: number; maxPayoutPerRound: number; maxGameExposure: number };

export function LimitsEditor({ gameId, limits, hard }: { gameId: string; limits: Limits; hard: { minStakeFloor: number; maxStakeCeiling: number; maxPayoutCeiling: number } }) {
  const [v, setV] = useState(() => Object.fromEntries(Object.entries(limits).map(([k, n]) => [k, formatChips(n).replace(/,/g, '')])) as Record<keyof Limits, string>);
  const fields: [keyof Limits, string][] = [
    ['minStake', 'Minimum stake'],
    ['maxStake', 'Maximum stake'],
    ['maxPayoutPerRound', 'Max payout per round'],
    ['maxGameExposure', 'Max open exposure (game)'],
  ];
  return (
    <ReasonedAction
      label="Edit limits"
      title="Edit stake and risk limits"
      description={`Checked by the server before every wager; they never change probabilities or payouts. Bounds: stake ${formatChips(hard.minStakeFloor)}–${formatChips(hard.maxStakeCeiling)} chips, payout per round ≤ ${formatChips(hard.maxPayoutCeiling)} chips, max stake ≤ max payout ≤ game exposure ≤ platform exposure.`}
      method="PUT"
      path={`/api/admin/games/${gameId}/limits`}
      body={(reason) => {
        const out = {} as Limits;
        for (const [k, label] of fields) {
          try {
            out[k] = parseChips(v[k]);
          } catch {
            throw new Error(`${label}: enter an amount in chips`);
          }
        }
        if (out.maxStake < out.minStake) throw new Error('The maximum stake must not be below the minimum stake');
        if (out.maxPayoutPerRound < out.maxStake) throw new Error('The maximum payout per round must be at least the maximum stake');
        if (out.maxGameExposure < out.maxPayoutPerRound) throw new Error('The game exposure limit must be at least the maximum payout per round');
        return { limits: out, reason };
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
