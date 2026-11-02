'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { postForm } from '../account/kyc-panel';
import { Button } from '../ui/button';
import { Field, Input, Select, Textarea } from '../ui/form';
import { Callout } from '../ui/misc';

const CATEGORIES: [string, string][] = [
  ['ACCOUNT', 'Account and sign-in'],
  ['PAYMENTS', 'Deposits and withdrawals'],
  ['VERIFICATION', 'Identity verification'],
  ['BONUSES', 'Bonuses and promotions'],
  ['GAMES', 'Games and results'],
  ['RESPONSIBLE_PLAY', 'Responsible play'],
  ['OTHER', 'Something else'],
];

function FileInput({ fileRef }: { fileRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <Field label="Attachment (optional: JPEG, PNG or PDF, up to 5 MB)">
      {(p) => <input {...p} ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="block w-full min-w-0 max-w-full text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-ink-100" />}
    </Field>
  );
}

export function NewTicketForm({ defaultCategory }: { defaultCategory?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(defaultCategory ?? 'ACCOUNT');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('category', category);
      form.set('subject', subject);
      form.set('body', body);
      const file = fileRef.current?.files?.[0];
      if (file) form.set('file', file);
      const res = await postForm<{ ticket: { id: string } }>('/api/support/tickets', form);
      router.push(`/support/${res.ticket.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="new-ticket">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Topic">
          {(p) => (
            <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Subject">{(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />}</Field>
      </div>
      <Field label="Message" hint="Never include your password. We will never ask for it.">
        {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={6} />}
      </Field>
      <FileInput fileRef={fileRef} />
      {error && <Callout tone="negative" role="alert">{error}</Callout>}
      <Button type="submit" variant="primary" loading={busy} disabled={subject.trim().length < 3 || !body.trim()} data-testid="ticket-submit">
        Send
      </Button>
    </form>
  );
}

/** Reply box for the player (path /api/support/tickets/:id/messages) or staff (/api/admin/support/:id/messages, with an internal-note option). */
export function ReplyForm({ path, staff = false }: { path: string; staff?: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('body', body);
      if (staff) form.set('internal', String(internal));
      const file = fileRef.current?.files?.[0];
      if (file) form.set('file', file);
      await postForm(path, form);
      setBody('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="reply-form">
      <Field label={staff && internal ? 'Internal note (staff only)' : 'Reply'}>
        {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={4} />}
      </Field>
      <FileInput fileRef={fileRef} />
      {staff && (
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-[var(--color-gold-500)]" />
          Internal note — not visible to the player
        </label>
      )}
      {error && <Callout tone="negative" role="alert">{error}</Callout>}
      <Button type="submit" variant="primary" loading={busy} disabled={!body.trim()}>
        {staff && internal ? 'Add note' : 'Send reply'}
      </Button>
    </form>
  );
}

export function CloseTicket({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/support/tickets/${id}/close`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined);
        router.refresh();
        setBusy(false);
      }}
    >
      Close ticket
    </Button>
  );
}
