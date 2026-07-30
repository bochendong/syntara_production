import { invoke } from '@tauri-apps/api/core';

import {
  getNativeCurrentUser,
  logoutNativeDevice,
  refreshNativeDeviceAuth,
  type NativeDeviceTokenPair,
  type NativeDeviceUser,
} from './platform-api-client';
import { registerNativePlatformTokenProvider } from './platform-auth-token';

const DEVICE_ID_STORAGE_KEY = 'syntara.native.device-id.v1';
const AUTH_CHANGED_EVENT = 'syntara-native-auth-changed';
const REFRESH_EARLY_MS = 60_000;

export interface NativeAuthSession extends NativeDeviceTokenPair {
  savedAt: string;
}

let cachedSession: NativeAuthSession | null | undefined;
let loadPromise: Promise<NativeAuthSession | null> | null = null;
let refreshPromise: Promise<NativeAuthSession | null> | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isValidUser(value: unknown): value is NativeDeviceUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<NativeDeviceUser>;
  return (
    typeof user.id === 'string' &&
    (user.name === null || typeof user.name === 'string') &&
    (user.email === null || typeof user.email === 'string') &&
    (user.image === null || typeof user.image === 'string') &&
    (user.role === 'USER' || user.role === 'ADMIN')
  );
}

function isValidSession(value: unknown): value is NativeAuthSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<NativeAuthSession>;
  return (
    session.status === 'authorized' &&
    typeof session.accessToken === 'string' &&
    session.accessToken.startsWith('snt_acc_') &&
    typeof session.refreshToken === 'string' &&
    session.refreshToken.startsWith('snt_ref_') &&
    typeof session.accessTokenExpiresAt === 'string' &&
    Number.isFinite(Date.parse(session.accessTokenExpiresAt)) &&
    typeof session.refreshTokenExpiresAt === 'string' &&
    Number.isFinite(Date.parse(session.refreshTokenExpiresAt)) &&
    typeof session.sessionId === 'string' &&
    typeof session.savedAt === 'string' &&
    isValidUser(session.user)
  );
}

function emitAuthChanged(session: NativeAuthSession | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<NativeAuthSession | null>(AUTH_CHANGED_EVENT, { detail: session }),
  );
}

async function persistSession(session: NativeAuthSession): Promise<void> {
  await invoke('save_native_auth_session', { session: JSON.stringify(session) });
  cachedSession = session;
  emitAuthChanged(session);
}

export function getNativeDeviceIdentity(): { deviceId: string; deviceName: string } {
  let deviceId = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  }
  const appleMobile =
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return {
    deviceId,
    deviceName: appleMobile ? 'Syntara iPad App' : 'Syntara Mac App',
  };
}

export async function loadNativeAuthSession(): Promise<NativeAuthSession | null> {
  if (cachedSession !== undefined) return cachedSession;
  if (!isTauriRuntime()) return null;
  if (loadPromise) return loadPromise;

  loadPromise = invoke<string | null>('load_native_auth_session')
    .then(async (serialized) => {
      if (!serialized) {
        cachedSession = null;
        return null;
      }
      try {
        const parsed: unknown = JSON.parse(serialized);
        if (isValidSession(parsed)) {
          cachedSession = parsed;
          return parsed;
        }
      } catch {
        // Invalid or obsolete Keychain payloads are removed below.
      }
      await invoke('clear_native_auth_session');
      cachedSession = null;
      return null;
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

export async function saveNativeAuthSession(
  tokenPair: NativeDeviceTokenPair,
): Promise<NativeAuthSession> {
  const session: NativeAuthSession = {
    ...tokenPair,
    savedAt: new Date().toISOString(),
  };
  await persistSession(session);
  return session;
}

export async function clearNativeAuthSession(): Promise<void> {
  cachedSession = null;
  loadPromise = null;
  refreshPromise = null;
  if (isTauriRuntime()) {
    await invoke('clear_native_auth_session');
  }
  emitAuthChanged(null);
}

export async function getNativeAccessToken(): Promise<string | undefined> {
  const session = await loadNativeAuthSession();
  if (!session) return undefined;

  const now = Date.now();
  if (Date.parse(session.refreshTokenExpiresAt) <= now) {
    await clearNativeAuthSession();
    return undefined;
  }
  if (Date.parse(session.accessTokenExpiresAt) > now + REFRESH_EARLY_MS) {
    return session.accessToken;
  }

  if (!refreshPromise) {
    refreshPromise = refreshNativeDeviceAuth(session.refreshToken)
      .then(saveNativeAuthSession)
      .catch(async () => {
        await clearNativeAuthSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return (await refreshPromise)?.accessToken;
}

export async function validateNativeAuthSession(): Promise<NativeAuthSession | null> {
  const token = await getNativeAccessToken();
  if (!token) return null;
  try {
    const current = await getNativeCurrentUser(token);
    const session = await loadNativeAuthSession();
    if (!session) return null;
    if (current.user.id !== session.user.id) {
      const updated = { ...session, user: current.user, savedAt: new Date().toISOString() };
      await persistSession(updated);
      return updated;
    }
    return session;
  } catch {
    await clearNativeAuthSession();
    return null;
  }
}

export async function logoutNativeAuthSession(): Promise<void> {
  const session = await loadNativeAuthSession();
  if (session) {
    try {
      await logoutNativeDevice(session.accessToken);
    } catch {
      // Local logout must still succeed if the network or remote session is unavailable.
    }
  }
  await clearNativeAuthSession();
}

export function subscribeNativeAuth(
  listener: (session: NativeAuthSession | null) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<NativeAuthSession | null>).detail);
  };
  window.addEventListener(AUTH_CHANGED_EVENT, handler);
  return () => window.removeEventListener(AUTH_CHANGED_EVENT, handler);
}

registerNativePlatformTokenProvider(getNativeAccessToken);
