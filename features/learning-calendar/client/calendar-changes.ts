'use client';

import { useAuthStore } from '@/lib/store/auth';

const CHANGE_EVENT = 'syntara:learning-calendar-changed';
const CHANNEL_NAME = 'syntara:learning-calendar';
const SOURCE_ID = Math.random().toString(36).slice(2);

export function notifyLearningCalendarChanged() {
  if (typeof window === 'undefined') return;
  const ownerId = useAuthStore.getState().userId;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: ownerId }));
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ ownerId, source: SOURCE_ID });
    channel.close();
  } catch {
    /* Cross-tab notifications are optional; the write already succeeded. */
  }
}

export function subscribeLearningCalendarChanges(listener: (ownerId: string) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(CHANGE_EVENT, handler);
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    /* Keep same-tab updates available. */
  }
  if (channel)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const change = event.data as { ownerId?: unknown; source?: unknown } | null;
      if (change && typeof change.ownerId === 'string' && change.source !== SOURCE_ID)
        listener(change.ownerId);
    };
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    channel?.close();
  };
}
