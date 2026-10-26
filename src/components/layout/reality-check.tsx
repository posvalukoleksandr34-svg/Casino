'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
import { Chips } from '../ui/misc';
import { useSession } from './session-provider';

interface ResponsibleInfo {
  limits: { realityCheckMinutes: number | null };
  usage: { netLoss24h: number; wagered24h: number };
  sessionStartedAt: string;
}

/**
 * Periodic reality check: if the player enabled it, shows elapsed session
 * time and 24-hour results every N minutes. Purely informational; it never
 * encourages further play.
 */
export function RealityCheck() {
  const { user } = useSession();
  const [info, setInfo] = useState<ResponsibleInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const schedule = async () => {
      const data = await api<ResponsibleInfo>('/api/responsible').catch(() => null);
      if (cancelled || !data?.limits.realityCheckMinutes) return;
      setInfo(data);
      const periodMs = data.limits.realityCheckMinutes * 60_000;
      const elapsed = Date.now() - new Date(data.sessionStartedAt).getTime();
      const wait = periodMs - (elapsed % periodMs);
      timer = setTimeout(async () => {
        const fresh = await api<ResponsibleInfo>('/api/responsible').catch(() => null);
        if (!cancelled && fresh) {
          setInfo(fresh);
          setOpen(true);
        }
        void schedule();
      }, wait);
    };
    void schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user]);

  if (!info) return null;
  const minutes = Math.floor((Date.now() - new Date(info.sessionStartedAt).getTime()) / 60_000);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Reality check"
      footer={
        <>
          <Link href="/responsible-play" className="inline-flex h-10 items-center rounded-xl border border-ink-600 px-4 text-sm text-ink-200 hover:border-gold-600">
            Take a break
          </Link>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Continue
          </Button>
        </>
      }
    >
      <p>You have been signed in for {minutes} minutes.</p>
      <p className="mt-2">
        In the last 24 hours you wagered <Chips amount={info.usage.wagered24h} /> and your net result is{' '}
        <Chips amount={-info.usage.netLoss24h} sign colored />.
      </p>
      <p className="mt-3 text-ink-400">Every game has a house edge. Chips are virtual and have no monetary value.</p>
    </Modal>
  );
}
