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
 * stored in the audit trail together with the before/after values.
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
}: {
  label: ReactNode;
  title: string;
  description?: ReactNode;
  method?: 'POST' | 'PUT' | 'PATCH';
  path: string;
  body: (reason: string) => Record<string, unknown> | null;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  idempotent?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  onDone?: (result: unknown) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);

  async function submit() {
    const payload = body(reason);
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(path, { method, body: payload, idempotencyKey: idempotent ? key : undefined });
      toast.push({ tone: 'positive', title: `${title}: done`, body: 'Recorded in the audit log.' });
      setOpen(false);
      setReason('');
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
            <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={reason.trim().length < 5}>
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
          {error && <Callout tone="negative">{error}</Callout>}
        </div>
      </Modal>
    </>
  );
}
