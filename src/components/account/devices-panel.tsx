'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';

export interface DeviceView {
  id: string;
  device: string;
  current: boolean;
  remembered: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/** Signed-in devices: sign one out, or every device except this one. */
export function DevicesPanel({ devices }: { devices: DeviceView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(id: string, fn: () => Promise<unknown>, done: string) {
    setBusy(id);
    try {
      await fn();
      toast.push({ tone: 'positive', title: done });
      router.refresh();
    } catch (err) {
      toast.push({ tone: 'negative', title: 'Not signed out', body: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }
  const others = devices.filter((d) => !d.current).length;
  return (
    <div className="space-y-3" data-testid="devices">
      <ul className="divide-y divide-white/[0.06] text-sm">
        {devices.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-ink-100">
                {d.device}
                {d.current && <Badge tone="positive">This device</Badge>}
                {d.remembered && <Badge tone="info">Remembered</Badge>}
              </span>
              <span className="block text-xs text-ink-400">
                Signed in {new Date(d.createdAt).toLocaleString()} · last active {new Date(d.lastSeenAt).toLocaleString()} · expires {new Date(d.expiresAt).toLocaleDateString()}
              </span>
            </span>
            {!d.current && (
              <Button size="sm" variant="ghost" loading={busy === d.id} disabled={busy !== null} onClick={() => run(d.id, () => api(`/api/account/sessions/${d.id}`, { method: 'DELETE' }), 'Device signed out')}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 && (
        <Button variant="secondary" size="sm" loading={busy === 'others'} disabled={busy !== null} onClick={() => run('others', () => api('/api/account/sessions/others', { method: 'POST', body: {} }), 'Other devices signed out')} data-testid="sign-out-others">
          Sign out all other devices ({others})
        </Button>
      )}
    </div>
  );
}
