'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Textarea } from '../ui/form';
import { Callout } from '../ui/misc';
import { Modal } from '../ui/modal';
import { useToast } from '../ui/toast';

/** Approve (executes), reject (with a reason) or cancel (own request). The server re-checks who may decide. */
export function ApprovalActions({ id, summary, canDecide, canCancel }: { id: string; summary: string; canDecide: boolean; canCancel: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canDecide && !canCancel) return null;

  const submit = async () => {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/approvals/${id}`, { method: 'POST', body: { decision: mode, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast.push({ tone: 'positive', title: mode === 'approve' ? 'Approved and executed' : mode === 'reject' ? 'Request rejected' : 'Request cancelled', body: 'Recorded in the audit log.' });
      setMode(null);
      setNote('');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {canDecide && (
        <>
          <Button size="sm" variant="primary" onClick={() => setMode('approve')}>
            Approve
          </Button>
          <Button size="sm" variant="danger" onClick={() => setMode('reject')}>
            Reject
          </Button>
        </>
      )}
      {canCancel && (
        <Button size="sm" variant="subtle" onClick={() => setMode('cancel')}>
          Cancel request
        </Button>
      )}
      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'approve' ? 'Approve and execute' : mode === 'reject' ? 'Reject request' : 'Cancel your request'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Back
            </Button>
            <Button variant={mode === 'reject' ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={mode === 'reject' && note.trim().length < 5}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-300">{summary}</p>
          {mode === 'approve' && <p className="text-sm text-ink-300">Approving executes the operation immediately and exactly once. You are confirming that you checked the reason and the parameters.</p>}
          <Field label={mode === 'reject' ? 'Reason for rejecting (required)' : 'Note (optional)'}>
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
          </Field>
          {error && (
            <Callout tone="negative" role="alert">
              {error}
            </Callout>
          )}
        </div>
      </Modal>
    </div>
  );
}
