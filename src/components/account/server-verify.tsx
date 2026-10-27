'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Callout } from '../ui/misc';

/** Asks the server to recompute this round from its revealed seed and compare it with the stored result. */
export function ServerVerify({ roundId }: { roundId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { verification } = await api<{ verification: { matches: boolean; description: string } }>('/api/fairness/verify-round', {
        method: 'POST',
        body: { roundId },
      });
      setResult(
        verification.matches
          ? { ok: true, text: `Server recomputation matches the stored result: ${verification.description}.` }
          : { ok: false, text: `The recomputed outcome (${verification.description}) does not match the stored result. Please report this round to support.` },
      );
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button variant="secondary" size="sm" onClick={run} loading={busy} data-testid="server-verify">
        Check this round on the server
      </Button>
      {result && (
        <Callout tone={result.ok ? 'positive' : 'negative'} role={result.ok ? 'status' : 'alert'}>
          {result.text}
        </Callout>
      )}
    </div>
  );
}
