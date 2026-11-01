'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { normaliseCode, VERIFICATION_CODE_LENGTH } from '@/lib/account-policy';
import { api, errorMessage } from '@/lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';

export interface PhoneStatusView {
  available: boolean;
  phone: string | null;
  verified: boolean;
  pending: { expiresAt: string; attemptsLeft: number; sent: boolean | null; resendAvailableAt: string } | null;
}

/** SMS verification of the stored number — only when the operator configured an SMS provider. */
export function PhoneVerify({ initial, display }: { initial: PhoneStatusView; display: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'confirm' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy('send');
    setMessage(null);
    try {
      const r = await api<{ phone: PhoneStatusView }>('/api/account/phone/verify', { method: 'POST', body: {} });
      setStatus(r.phone);
      setMessage(r.phone.pending?.sent === false ? { ok: false, text: 'The text message could not be sent. Try again in a moment.' } : { ok: true, text: 'We sent a code by text message.' });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };
  const confirm = async (value: string) => {
    if (value.length !== VERIFICATION_CODE_LENGTH) return;
    setBusy('confirm');
    setMessage(null);
    try {
      const r = await api<{ phone: PhoneStatusView }>('/api/account/phone/verify/confirm', { method: 'POST', body: { code: value } });
      setStatus(r.phone);
      setMessage({ ok: true, text: 'Phone number verified.' });
      router.refresh();
    } catch (err) {
      setCode('');
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Phone verification" subtitle="Optional. A verified number lets support confirm account ownership more reliably." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-100">{display ?? 'No phone number on file'}</span>
          {status.phone && (status.verified ? <Badge tone="positive">Verified by SMS</Badge> : <Badge>Unverified</Badge>)}
        </div>
        {!status.available ? (
          <p className="text-sm text-ink-400" data-testid="phone-verification-unavailable">
            Phone verification is not available on this site yet: no SMS provider is configured. Your number is stored and shown as unverified.
          </p>
        ) : status.phone && !status.verified ? (
          <div className="space-y-3">
            {status.pending ? (
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirm(code);
                }}
              >
                <Field label="Code from the text message" className="sm:w-56">
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="text-center font-mono tracking-[0.35em]"
                      value={code}
                      onChange={(e) => {
                        const next = normaliseCode(e.target.value);
                        setCode(next);
                        if (next.length === VERIFICATION_CODE_LENGTH) void confirm(next);
                      }}
                    />
                  )}
                </Field>
                <Button type="submit" variant="primary" loading={busy === 'confirm'} disabled={code.length !== VERIFICATION_CODE_LENGTH}>
                  Verify
                </Button>
              </form>
            ) : null}
            <Button variant="subtle" onClick={send} loading={busy === 'send'}>
              {status.pending ? 'Send a new code' : 'Send a code by SMS'}
            </Button>
          </div>
        ) : null}
        {message && (
          <Callout tone={message.ok ? 'positive' : 'negative'} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </Callout>
        )}
      </CardBody>
    </Card>
  );
}
