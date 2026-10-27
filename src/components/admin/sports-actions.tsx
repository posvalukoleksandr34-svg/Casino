'use client';

import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatChips } from '@/engine/money';
import { Field, Input, Select } from '../ui/form';
import { Callout } from '../ui/misc';
import { ReasonedAction } from './reasoned-action';

interface Preview {
  tickets: number;
  won: number;
  lost: number;
  voided: number;
  credit: number;
  ticketsCredited: number;
  alreadySettled: number;
  sameAsCurrent: boolean;
  isCorrection: boolean;
}

/** Server-computed effect of a result or void (read-only; nothing is recorded). */
function SettlementPreview({ eventId, query }: { eventId: string; query: string | null }) {
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setP(null);
    setError(null);
    if (!query) return;
    let live = true;
    api<Preview>(`/api/admin/sports/events/${eventId}/preview?${query}`)
      .then((r) => live && setP(r))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [eventId, query]);
  if (!query) return null;
  if (error) return <Callout tone="negative">{error}</Callout>;
  if (!p) return <p className="text-xs text-ink-400">Calculating settlement preview…</p>;
  if (p.sameAsCurrent) return <Callout tone="info">This is already the recorded result: nothing would change.</Callout>;
  return (
    <Callout tone={p.isCorrection ? 'warning' : 'info'} title={p.isCorrection ? 'Correction preview' : 'Settlement preview'}>
      {p.tickets} prediction{p.tickets === 1 ? '' : 's'}: {p.won} won, {p.lost} lost, {p.voided} void. {formatChips(p.credit)} chips would be credited to {p.ticketsCredited} prediction
      {p.ticketsCredited === 1 ? '' : 's'}.
      {p.isCorrection && ' Corrections only credit differences upward; nothing already paid is taken back.'}
    </Callout>
  );
}

/** Operator actions for one sports event; every action is audited with its reason. */
export function SportsEventActions({ eventId, hasResult, started, voided }: { eventId: string; hasResult: boolean; started: boolean; voided: boolean }) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const path = `/api/admin/sports/events/${eventId}`;
  const score = (v: string) => (/^\d{1,2}$/.test(v) ? Number(v) : null);
  const h = score(home);
  const a = score(away);
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
          description="Regular-time score. Predictions settle immediately, by the server, from this score; a correction only ever credits players the difference to a higher entitlement."
          path={path}
          body={(reason) => {
            if (h === null || a === null) throw new Error('Enter both scores (0–99)');
            return { action: 'result', home: h, away: a, reason };
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Home goals">{(p) => <Input {...p} inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value.replace(/\D/g, '').slice(0, 2))} />}</Field>
            <Field label="Away goals">{(p) => <Input {...p} inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value.replace(/\D/g, '').slice(0, 2))} />}</Field>
          </div>
          <SettlementPreview eventId={eventId} query={h !== null && a !== null ? `home=${h}&away=${a}` : null} />
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
        >
          <SettlementPreview eventId={eventId} query="void=1" />
        </ReasonedAction>
      )}
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Opening and early closing time for predictions (local time input, sent as UTC). */
export function PredictionWindowAction({ eventId, opensAt, closesAt, kickoffAt }: { eventId: string; opensAt: string | null; closesAt: string | null; kickoffAt: string }) {
  const [open, setOpen] = useState(toLocalInput(opensAt));
  const [close, setClose] = useState(toLocalInput(closesAt && closesAt !== kickoffAt ? closesAt : null));
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  return (
    <ReasonedAction
      label="Prediction window"
      title="Set the prediction window"
      description="Leave empty to open now and close at kick-off. The close can never be later than kick-off; the server enforces the window on every prediction."
      path={`/api/admin/sports/events/${eventId}`}
      body={(reason) => ({ action: 'window', opensAt: iso(open), closesAt: iso(close), reason })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Opens (your local time)">{(p) => <Input {...p} type="datetime-local" value={open} onChange={(e) => setOpen(e.target.value)} />}</Field>
        <Field label="Closes (your local time)">{(p) => <Input {...p} type="datetime-local" value={close} onChange={(e) => setClose(e.target.value)} />}</Field>
      </div>
    </ReasonedAction>
  );
}

/** Schedules an extra fictional fixture in demo mode. */
export function CreateDemoFixture({ competitions }: { competitions: { id: string; name: string; teams: { id: string; name: string }[] }[] }) {
  const [comp, setComp] = useState(competitions[0]?.id ?? '');
  const teams = competitions.find((c) => c.id === comp)?.teams ?? [];
  const [homeId, setHomeId] = useState(teams[0]?.id ?? '');
  const [awayId, setAwayId] = useState(teams[1]?.id ?? '');
  const [kickoff, setKickoff] = useState('');
  return (
    <ReasonedAction
      label="Schedule demo fixture"
      title="Schedule a demo fixture"
      variant="primary"
      description="Creates a fictional, clearly labelled demo fixture. Its odds come from the published demo model and its result from a seed committed now; you cannot set odds or a result in advance."
      path="/api/admin/sports/fixtures"
      body={(reason) => {
        if (!kickoff) throw new Error('Choose a kick-off time');
        if (homeId === awayId) throw new Error('Choose two different teams');
        return { competitionId: comp, homeId, awayId, kickoffAt: new Date(kickoff).toISOString(), reason };
      }}
    >
      <Field label="Competition">
        {(p) => (
          <Select
            {...p}
            value={comp}
            onChange={(e) => {
              const next = competitions.find((c) => c.id === e.target.value);
              setComp(e.target.value);
              setHomeId(next?.teams[0]?.id ?? '');
              setAwayId(next?.teams[1]?.id ?? '');
            }}
          >
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ['Home team', homeId, setHomeId],
            ['Away team', awayId, setAwayId],
          ] as const
        ).map(([label, value, set]) => (
          <Field key={label} label={label}>
            {(p) => (
              <Select {...p} value={value} onChange={(e) => set(e.target.value)}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>
      <Field label="Kick-off (your local time; 15 minutes to 14 days ahead)">{(p) => <Input {...p} type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />}</Field>
    </ReasonedAction>
  );
}
