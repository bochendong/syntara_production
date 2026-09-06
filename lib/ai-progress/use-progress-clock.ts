'use client';
import { useEffect, useState } from 'react';

/** One clock per surface, with no polling or timers when all tasks are finished. */
export function useProgressClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
