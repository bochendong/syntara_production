import { MARBLE_AVATAR_PUBLIC_PREFIX, MARBLE_AVATAR_URLS } from './marble-avatars';

/** Shared marble portrait collection, also bundled by the native app. */
export const COURSE_AVATAR_PUBLIC_PREFIX = MARBLE_AVATAR_PUBLIC_PREFIX;
export const COURSE_AVATAR_PRESET_URLS = MARBLE_AVATAR_URLS;

function hashStringToUint32(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickRandomCourseAvatarUrl(): string {
  return COURSE_AVATAR_PRESET_URLS[Math.floor(Math.random() * COURSE_AVATAR_PRESET_URLS.length)];
}

export function pickStableCourseAvatarUrl(seed: string): string {
  return COURSE_AVATAR_PRESET_URLS[hashStringToUint32(seed) % COURSE_AVATAR_PRESET_URLS.length];
}

export function resolveCourseAvatarDisplayUrl(
  courseId: string | null | undefined,
  storedAvatarUrl: string | null | undefined,
): string {
  const url = storedAvatarUrl?.trim();
  if (url) return url;
  return pickStableCourseAvatarUrl(courseId?.trim() || '__no_course__');
}
