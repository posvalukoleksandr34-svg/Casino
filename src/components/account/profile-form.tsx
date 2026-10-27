'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Field, Input } from '../ui/form';
import { Callout } from '../ui/misc';
import { AvatarPicker } from './avatar-picker';

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
        <AvatarPicker value={avatar} onChange={setAvatar} name={displayName.trim() || username} />
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
