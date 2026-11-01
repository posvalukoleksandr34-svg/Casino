'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Callout } from '../ui/misc';

interface CheckResult {
  verified: { ok: boolean; transport: string; reason?: string };
  sent: boolean | null;
  failure: string | null;
}

/** Connect-and-authenticate check, and a test message to the operator's own address. */
export function MailCheck({ canOperate, email }: { canOperate: boolean; email: string }) {
  const [busy, setBusy] = useState<'verify' | 'test' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canOperate) return null;
  const run = async (action: 'verify' | 'test') => {
    setBusy(action);
    setResult(null);
    try {
      const r = await api<CheckResult>('/api/admin/health/mail', { method: 'POST', body: { action } });
      if (!r.verified.ok) setResult({ ok: false, text: r.verified.reason ?? 'The mail transport is not usable.' });
      else if (action === 'verify') setResult({ ok: true, text: r.verified.reason ?? 'Connected and authenticated to the mail server. Nothing was sent.' });
      else if (r.sent) setResult({ ok: true, text: `Test message accepted by the mail server for ${email}. Check that it arrived in the inbox (not spam) and that SPF, DKIM and DMARC pass.` });
      else setResult({ ok: false, text: r.failure ?? 'The test message was not accepted.' });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="subtle" loading={busy === 'verify'} disabled={busy !== null} onClick={() => run('verify')}>
          Check connection
        </Button>
        <Button size="sm" variant="subtle" loading={busy === 'test'} disabled={busy !== null} onClick={() => run('test')}>
          Send test e-mail to me
        </Button>
      </div>
      {result && (
        <Callout tone={result.ok ? 'positive' : 'negative'} role={result.ok ? 'status' : 'alert'}>
          {result.text}
        </Callout>
      )}
    </div>
  );
}
