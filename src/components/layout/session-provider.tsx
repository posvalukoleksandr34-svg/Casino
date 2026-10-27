'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

export interface ClientUser {
  id: string;
  email: string;
  username: string;
  role: string;
  isStaff: boolean;
  preferences: Record<string, unknown>;
  displayName?: string | null;
  avatar?: string | null;
  sessionStartedAt: string;
}

interface SessionValue {
  user: ClientUser | null;
  balance: number;
  setBalance: (b: number) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ initialUser, initialBalance, children }: { initialUser: ClientUser | null; initialBalance: number; children: ReactNode }) {
  const [user, setUser] = useState(initialUser);
  const [balance, setBalance] = useState(initialBalance);
  // The root layout stays mounted across navigations; when the server
  // re-renders it (sign-in, sign-out, router.refresh) adopt the new values.
  const userKey = JSON.stringify(initialUser);
  useEffect(() => {
    setUser(initialUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);
  useEffect(() => {
    setBalance(initialBalance);
  }, [initialBalance]);
  const refresh = useCallback(async () => {
    const me = await api<{ user: ClientUser | null; balance?: number }>('/api/auth/me');
    setUser(me.user);
    setBalance(me.balance ?? 0);
  }, []);
  const value = useMemo(() => ({ user, balance, setBalance, refresh }), [user, balance, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
