'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/form';
import { Callout, Mono } from '../ui/misc';

/**
 * Two-factor authentication for the signed-in account: set-up (secret shown
 * once as text and an otpauth link for authenticator apps), confirmation with
 * a first code (recovery codes shown once), verifying the current session,
 * and turning it off with a valid code.
 */
export function MfaSettings({ enabled, sessionVerified, recoveryCodesLeft }: { enabled: boolean; sessionVerified: boolean; recoveryCodesLeft: number }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call<T>(path: string, body?: Record<string, unknown>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await api<T>(path, { method: 'POST', body: body ?? {} });
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <div className="space-y-4">
        <Callout tone="positive" title="Two-factor authentication is on" role="status">
          Store these recovery codes somewhere safe, away from your authenticator device. Each works once, if you lose the device. They will not be shown again.
        </Callout>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="mfa-recovery-codes">
          {codes.map((c) => (
            <li key={c}>
              <Mono className="block rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-center text-sm">{c}</Mono>
            </li>
          ))}
        </ul>
        <Button
          variant="primary"
          onClick={() => {
            setCodes(null);
            router.refresh();
          }}
        >
          I have stored my recovery codes
        </Button>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-300">
          Two-factor authentication is <strong className="text-positive">on</strong>. {recoveryCodesLeft} unused recovery code{recoveryCodesLeft === 1 ? '' : 's'} left.
          {sessionVerified ? ' This session passed the second factor.' : ' This session has not passed the second factor yet.'}
        </p>
        {error && (
          <Callout tone="negative" role="alert">
            {error}
          </Callout>
        )}
        <Field label="Authenticator or recovery code">{(p) => <Input {...p} autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} className="max-w-xs" />}</Field>
        <div className="flex flex-wrap gap-2">
          {!sessionVerified && (
            <Button
              variant="primary"
              loading={busy}
              disabled={code.trim().length < 6}
              onClick={async () => {
                if (await call('/api/account/mfa/verify', { code })) {
                  setCode('');
                  router.refresh();
                }
              }}
            >
              Verify this session
            </Button>
          )}
          <Button
            variant="danger"
            loading={busy}
            disabled={code.trim().length < 6}
            onClick={async () => {
              if (await call('/api/account/mfa/disable', { code })) {
                setCode('');
                router.refresh();
              }
            }}
          >
            Turn off two-factor authentication
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <Callout tone="negative" role="alert">
          {error}
        </Callout>
      )}
      {!setup ? (
        <>
          <p className="text-sm text-ink-300">
            Use any TOTP authenticator app (30-second, 6-digit codes). After it is on, signing in asks for a code after your password.
          </p>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              const res = await call<{ secret: string; uri: string }>('/api/account/mfa/setup');
              if (res) setSetup(res);
            }}
          >
            Set up two-factor authentication
          </Button>
        </>
      ) : (
        <>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-300">
            <li>
              In your authenticator app, add an account by entering this key manually (or open the link on the device that has the app):
              <div data-testid="mfa-secret" data-secret={setup.secret}>
                <Mono className="mt-1 block break-all rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-gold-200">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</Mono>
              </div>
              <a href={setup.uri} className="mt-1 inline-block text-xs text-gold-400">
                Open in authenticator app
              </a>
            </li>
            <li>Enter the 6-digit code the app shows to confirm.</li>
          </ol>
          <Field label="Code from the app">{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="max-w-[10rem]" />}</Field>
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={busy}
              disabled={code.length !== 6}
              onClick={async () => {
                const res = await call<{ recoveryCodes: string[] }>('/api/account/mfa/confirm', { code });
                if (res) {
                  setSetup(null);
                  setCode('');
                  setCodes(res.recoveryCodes);
                }
              }}
            >
              Confirm and turn on
            </Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
