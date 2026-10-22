import { accountStorageKey } from '../data/browser-runtime';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'syntara.native.sidebar-background.v1';
const CHANGED_EVENT = 'syntara-native-sidebar-background-changed';
let sessionEnabled = false;

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(accountStorageKey(STORAGE_KEY)) === 'true';
  } catch {
    return sessionEnabled;
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGED_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

function setEnabled(enabled: boolean) {
  sessionEnabled = enabled;
  try {
    window.localStorage.setItem(accountStorageKey(STORAGE_KEY), String(enabled));
  } catch {
    // Keep the setting usable for this session when storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Opt in to sidebar artwork; profile cards and course galaxies stay independent. */
export function useSidebarBackground() {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
  return [enabled, setEnabled] as const;
}
