'use client';

import { useEffect, useState } from 'react';
import { useSession } from '../layout/session-provider';

export function useReducedMotion(): boolean {
  const { user } = useSession();
  const [system, setSystem] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystem(mq.matches);
    const onChange = () => setSystem(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return system || Boolean(user?.preferences?.reducedMotion);
}
