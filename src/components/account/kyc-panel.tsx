'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field, Select } from '../ui/form';
import { Callout } from '../ui/misc';
import { useToast } from '../ui/toast';

const KINDS: [string, string][] = [
  ['ID_FRONT', 'Identity document (front)'],
  ['ID_BACK', 'Identity document (back)'],
  ['PROOF_OF_ADDRESS', 'Proof of address (dated within 3 months)'],
  ['SELFIE', 'Selfie holding the identity document'],
  ['OTHER', 'Other supporting document'],
];

/** Sends a multipart form with the same CSRF headers as the JSON client (same origin; no Idempotency-Key needed). */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  return json;
}

export function KycUpload({ canUpload }: { canUpload: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('ID_FRONT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canUpload) return null;
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('Choose a file first.');
    if (file.size > 5 * 1024 * 1024) return setError('Files can be at most 5 MB.');
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('kind', kind);
      form.set('file', file);
      await postForm('/api/kyc/documents', form);
      toast.push({ tone: 'positive', title: 'Document uploaded', body: 'It is stored privately. Submit your documents for review when all required ones are uploaded.' });
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={upload} className="space-y-4" data-testid="kyc-upload">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Document type">
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="File (JPEG, PNG or PDF, up to 5 MB)">
          {(p) => <input {...p} ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="block w-full min-w-0 max-w-full text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-ink-100" />}
        </Field>
      </div>
      {error && <Callout tone="negative" role="alert">{error}</Callout>}
      <Button type="submit" variant="secondary" loading={busy} data-testid="kyc-upload-submit">
        Upload
      </Button>
    </form>
  );
}

export function KycSubmit({ canSubmit }: { canSubmit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/kyc/submit', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(((await res.json()) as { error?: { message?: string } }).error?.message ?? 'Could not submit');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button variant="primary" onClick={submit} loading={busy} disabled={!canSubmit} data-testid="kyc-submit">
        Submit for review
      </Button>
      {error && <Callout tone="negative" role="alert">{error}</Callout>}
    </div>
  );
}

export function DocStatus({ status }: { status: string }) {
  return status === 'ACCEPTED' ? <Badge tone="positive">Accepted</Badge> : status === 'REJECTED' ? <Badge tone="negative">Not accepted</Badge> : <Badge tone="info">Waiting for review</Badge>;
}
