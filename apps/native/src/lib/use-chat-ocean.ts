import { useSyncExternalStore } from 'react';
import { accountStorageKey } from '../data/browser-runtime';

const STORAGE_KEY = 'syntara.native.chat-ocean.v1';
const CHANGED_EVENT = 'syntara-chat-ocean-changed';
const sessionValues = new Map<string, boolean>();

function readEnabled() {
  const key = accountStorageKey(STORAGE_KEY);
  if (sessionValues.has(key)) return sessionValues.get(key)!;
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  const key = accountStorageKey(STORAGE_KEY);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      sessionValues.delete(key);
      listener();
    }
  };
  window.addEventListener(CHANGED_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

function setEnabled(enabled: boolean) {
  const key = accountStorageKey(STORAGE_KEY);
  sessionValues.set(key, enabled);
  try {
    window.localStorage.setItem(key, String(enabled));
  } catch {
    // The in-memory value keeps the switch working when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** One opt-in preference shared by ordinary and course chats, scoped to the account. */
export function useChatOcean() {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
  return [enabled, setEnabled] as const;
}
