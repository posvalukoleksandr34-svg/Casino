'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AVATAR_PRESETS } from '@/lib/avatars';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';
import { Avatar } from './avatar';

export function ProfileForm({ username, initial }: { username: string; initial: { displayName: string | null; avatar: string | null } }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName ?? '');
  const [avatar, setAvatar] = useState<string | null>(initial.avatar);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = displayName.trim() !== (initial.displayName ?? '') || avatar !== initial.avatar;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/account/profile', { method: 'PATCH', body: { displayName: displayName.trim() || null, avatar } });
      setMessage({ ok: true, text: 'Profile saved.' });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Edit profile" subtitle="Only you can see your profile. Your username stays your sign-in name." />
      <CardBody className="space-y-5">
        <Field label="Display name" hint="2–32 characters: letters, digits, spaces, dots, dashes, underscores. Leave empty to show your username.">
          {(p) => <Input {...p} value={displayName} maxLength={32} placeholder={username} onChange={(e) => setDisplayName(e.target.value)} />}
        </Field>
        <fieldset>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Avatar</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar">
            <button
              type="button"
              role="radio"
              aria-checked={avatar === null}
              aria-label="Initials (no avatar)"
              onClick={() => setAvatar(null)}
              className={cn('rounded-2xl border-2 p-1', avatar === null ? 'border-gold-400' : 'border-transparent hover:border-ink-500')}
            >
              <Avatar avatar={null} name={displayName.trim() || username} className="size-12" />
            </button>
            {AVATAR_PRESETS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={avatar === a.id}
                aria-label={a.label}
                title={a.label}
                onClick={() => setAvatar(a.id)}
                className={cn('rounded-2xl border-2 p-1', avatar === a.id ? 'border-gold-400' : 'border-transparent hover:border-ink-500')}
              >
                <Avatar avatar={a.id} name={username} className="size-12" />
              </button>
            ))}
          </div>
        </fieldset>
        {message && (
          <Callout tone={message.ok ? 'positive' : 'negative'} role={message.ok ? 'status' : 'alert'}>
            {message.text}
          </Callout>
        )}
        <Button variant="primary" onClick={save} loading={busy} disabled={!changed} data-testid="profile-save">
          Save profile
        </Button>
      </CardBody>
    </Card>
  );
}
