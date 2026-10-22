import { MARBLE_AVATAR_PUBLIC_PREFIX, MARBLE_AVATAR_URLS } from './marble-avatars';

/** Shared marble portrait collection, also bundled by the native app. */
export const NOTEBOOK_AGENT_AVATAR_PUBLIC_PREFIX = MARBLE_AVATAR_PUBLIC_PREFIX;
export const NOTEBOOK_AGENT_AVATAR_PRESET_URLS = MARBLE_AVATAR_URLS;

function hashStringToUint32(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickRandomNotebookAgentAvatarUrl(): string {
  return NOTEBOOK_AGENT_AVATAR_PRESET_URLS[
    Math.floor(Math.random() * NOTEBOOK_AGENT_AVATAR_PRESET_URLS.length)
  ];
}

export function pickStableNotebookAgentAvatarUrl(seed: string): string {
  return NOTEBOOK_AGENT_AVATAR_PRESET_URLS[
    hashStringToUint32(seed) % NOTEBOOK_AGENT_AVATAR_PRESET_URLS.length
  ];
}

export function resolveNotebookAgentAvatarDisplayUrl(
  notebookId: string,
  storedAvatarUrl?: string | null | undefined,
): string {
  const url = storedAvatarUrl?.trim();
  if (url) return url;
  return pickStableNotebookAgentAvatarUrl(notebookId);
}
