'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Textarea } from '../ui/form';
import { Callout } from '../ui/misc';

/** Adds an internal staff note on a player (append-only; never shown to the player). */
export function AddUserNote({ userId }: { userId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/api/admin/users/${userId}/notes`, { method: 'POST', body: { body } });
          setBody('');
          router.refresh();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      data-testid="add-note"
    >
      <Field label="New note (staff only, permanent)">{(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} />}</Field>
      {error && <Callout tone="negative">{error}</Callout>}
      <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={body.trim().length < 3}>
        Add note
      </Button>
    </form>
  );
}
