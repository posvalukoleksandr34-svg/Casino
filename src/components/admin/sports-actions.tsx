'use client';

import { useState } from 'react';
import { Field, Input } from '../ui/form';
import { ReasonedAction } from './reasoned-action';

/** Operator actions for one sports event; every action is audited with its reason. */
export function SportsEventActions({ eventId, hasResult, started, voided }: { eventId: string; hasResult: boolean; started: boolean; voided: boolean }) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const path = `/api/admin/sports/events/${eventId}`;
  const score = (v: string) => (/^\d{1,2}$/.test(v) ? Number(v) : null);
  return (
    <div className="flex flex-wrap gap-2">
      {!hasResult && (
        <>
          <ReasonedAction label="Suspend" title="Suspend event" description="Stops new predictions and holds accepted ones. No chips move." path={path} body={(reason) => ({ action: 'suspend', reason })} />
          <ReasonedAction label="Resume" title="Resume event" description="Accepts predictions again if the event has not started." path={path} body={(reason) => ({ action: 'resume', reason })} />
        </>
      )}
      {started && (
        <ReasonedAction
          label={hasResult ? 'Correct result' : 'Record result'}
          title={hasResult ? 'Correct the result' : 'Record the result'}
          description="Regular-time score. Predictions settle immediately. A correction only ever credits players the difference to a higher entitlement; nothing is taken back."
          path={path}
          body={(reason) => (score(home) === null || score(away) === null ? null : { action: 'result', home: score(home), away: score(away), reason })}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Home goals">{(p) => <Input {...p} inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value.replace(/\D/g, '').slice(0, 2))} />}</Field>
            <Field label="Away goals">{(p) => <Input {...p} inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value.replace(/\D/g, '').slice(0, 2))} />}</Field>
          </div>
        </ReasonedAction>
      )}
      {!voided && (
        <ReasonedAction
          label="Void"
          title="Void event"
          variant="danger"
          description="Every open prediction is refunded in full, exactly once. Already-paid predictions keep what they were paid."
          path={path}
          body={(reason) => ({ action: 'void', reason })}
        />
      )}
    </div>
  );
}
