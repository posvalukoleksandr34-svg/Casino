'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Callout } from '../ui/misc';

export function JoinTournament({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="primary"
        loading={busy}
        data-testid="join-tournament"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/api/tournaments/${slug}/join`, { method: 'POST', body: {} });
            router.refresh();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Join tournament
      </Button>
      {error && <Callout tone="negative">{error}</Callout>}
    </div>
  );
}
