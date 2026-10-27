'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api, errorMessage, newIdempotencyKey } from '@/lib/api';
import { Button, type ButtonProps } from '../ui/button';
import { Field, Textarea } from '../ui/form';
import { Callout } from '../ui/misc';
import { Modal } from '../ui/modal';
import { useToast } from '../ui/toast';

/**
 * Every state-changing admin action requires a written reason, which is
 * stored in the audit trail together with the before/after values. `body`
 * may throw an Error to show a validation message instead of submitting;
 * `confirm` adds a checkbox that must be ticked first (high-impact actions).
 * The server validates and authorises everything again.
 */
export function ReasonedAction({
  label,
  title,
  description,
  method = 'POST',
  path,
  body,
  variant = 'secondary',
  size = 'sm',
  idempotent = false,
  children,
  disabled,
  onDone,
  confirm,
}: {
  label: ReactNode;
  title: string;
  description?: ReactNode;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body: (reason: string) => Record<string, unknown> | null;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  idempotent?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  onDone?: (result: unknown) => void;
  confirm?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [confirmed, setConfirmed] = useState(false);

  async function submit() {
    let payload: Record<string, unknown> | null;
    try {
      payload = body(reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the form');
      return;
    }
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(path, { method, body: payload, idempotencyKey: idempotent ? key : undefined });
      toast.push({ tone: 'positive', title: `${title}: done`, body: 'Recorded in the audit log.' });
      setOpen(false);
      setReason('');
      setConfirmed(false);
      setKey(newIdempotencyKey());
      onDone?.(result);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={disabled}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={reason.trim().length < 5 || (Boolean(confirm) && !confirmed)}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {description && <div className="text-ink-300">{description}</div>}
          {children}
          <Field label="Reason (required, stored in the audit log)">
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Incident #142: RNG service latency" />}
          </Field>
          {confirm && (
            <label className="flex items-start gap-2 text-sm text-ink-200">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 accent-[var(--color-gold-500)]" />
              <span>{confirm}</span>
            </label>
          )}
          {error && (
            <Callout tone="negative" role="alert">
              {error}
            </Callout>
          )}
        </div>
      </Modal>
    </>
  );
}
