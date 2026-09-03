/**
 * Built-in course hero backgrounds. These live in `public/course_background/`
 * so course pages can keep a local, generated visual language.
 */
const COURSE_BACKGROUND_FILES: readonly string[] = [
  '/course_background/lecture-hall-photo.png',
  '/course_background/workspace-desk-photo.png',
  '/course_background/science-lab-photo.png',
  '/course_background/dark-tech-neural.png',
  '/course_background/city-strategy-photo.png',
  '/course_background/product-launch-dark.png',
  '/course_background/magazine-courtyard.png',
  '/course_background/forest-path-photo.png',
  '/course_background/cinematic-stage.png',
] as const;

const COURSE_BACKGROUND_FALLBACK = '/course_background/workspace-desk-photo.png';

function hashStringToUint32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Course ids are random, so this gives each newly created course a random-feeling
 * background while keeping the selected image stable across refreshes.
 */
export function pickStableCourseBackgroundUrl(seed: string): string {
  if (COURSE_BACKGROUND_FILES.length === 0) return COURSE_BACKGROUND_FALLBACK;
  const i = hashStringToUint32(seed) % COURSE_BACKGROUND_FILES.length;
  return COURSE_BACKGROUND_FILES[i] ?? COURSE_BACKGROUND_FALLBACK;
}

export function resolveCourseBackgroundDisplayUrl(courseId: string | null | undefined): string {
  const id = courseId?.trim();
  return pickStableCourseBackgroundUrl(id || '__no_course__');
}
