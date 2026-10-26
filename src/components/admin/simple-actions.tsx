'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';

export function RunReconciliation() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await api<{ status: string; mismatchCount: number }>('/api/admin/reconciliation', { method: 'POST', body: {} });
          toast.push({ tone: res.status === 'OK' ? 'positive' : 'negative', title: `Reconciliation ${res.status}`, body: `${res.mismatchCount} mismatch(es)` });
          router.refresh();
        } catch (err) {
          toast.push({ tone: 'negative', title: 'Reconciliation failed to run', body: errorMessage(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      Run now
    </Button>
  );
}
