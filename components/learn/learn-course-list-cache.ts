import type { CourseRecord } from '@/lib/utils/database';

const LEARN_COURSE_LIST_CACHE_PREFIX = 'syntara-learn-course-list-cache:v4';
const LEGACY_SESSION_CACHE_PREFIXES = [
  'syntara-learn-course-list-cache:v1',
  'syntara-learn-course-list-cache:v2',
  'syntara-learn-course-list-cache:v3',
] as const;
const LEARN_COURSE_LIST_CACHE_TTL_MS = 10 * 60 * 1000;
const LEARN_COURSE_LIST_STALE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function learnCourseListCacheKey(userId: string, prefix = LEARN_COURSE_LIST_CACHE_PREFIX) {
  return [prefix, encodeURIComponent(userId)].join(':');
}

function parseCachedCourses(raw: string | null, maxAgeMs: number): CourseRecord[] | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as {
    savedAt?: number;
    courses?: CourseRecord[];
  };
  if (
    typeof parsed.savedAt !== 'number' ||
    Date.now() - parsed.savedAt > maxAgeMs ||
    !Array.isArray(parsed.courses)
  ) {
    return null;
  }
  return parsed.courses;
}

function readMostRecentCourseListCache(maxAgeMs: number): CourseRecord[] | null {
  let best: { savedAt: number; courses: CourseRecord[] } | null = null;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(`${LEARN_COURSE_LIST_CACHE_PREFIX}:`)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '') as {
        savedAt?: number;
        courses?: CourseRecord[];
      };
      if (
        typeof parsed.savedAt !== 'number' ||
        Date.now() - parsed.savedAt > maxAgeMs ||
        !Array.isArray(parsed.courses) ||
        parsed.courses.length === 0
      ) {
        continue;
      }
      if (!best || parsed.savedAt > best.savedAt) {
        best = { savedAt: parsed.savedAt, courses: parsed.courses };
      }
    } catch {
      /* Ignore malformed cache entries. */
    }
  }
  return best?.courses ?? null;
}

export function readLearnCourseListCache(
  userId: string,
  options: { allowStale?: boolean } = {},
): CourseRecord[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const maxAgeMs = options.allowStale
      ? LEARN_COURSE_LIST_STALE_MAX_AGE_MS
      : LEARN_COURSE_LIST_CACHE_TTL_MS;
    const cached = parseCachedCourses(
      localStorage.getItem(learnCourseListCacheKey(userId)),
      maxAgeMs,
    );
    if (cached) return cached;

    for (const legacyPrefix of LEGACY_SESSION_CACHE_PREFIXES) {
      const legacy = parseCachedCourses(
        sessionStorage.getItem(learnCourseListCacheKey(userId, legacyPrefix)),
        maxAgeMs,
      );
      if (legacy) {
        writeLearnCourseListCache(userId, legacy);
        return legacy;
      }
    }
    if (!userId || userId === 'anonymous') {
      return readMostRecentCourseListCache(maxAgeMs);
    }
    return null;
  } catch {
    return null;
  }
}

export function writeLearnCourseListCache(userId: string, courses: CourseRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      learnCourseListCacheKey(userId),
      JSON.stringify({ savedAt: Date.now(), courses }),
    );
  } catch {
    /* localStorage may be unavailable */
  }
}

export function upsertLearnCourseListCache(userId: string, course: CourseRecord) {
  const current = readLearnCourseListCache(userId, { allowStale: true }) ?? [];
  const next = current.some((item) => item.id === course.id)
    ? current.map((item) => (item.id === course.id ? course : item))
    : [course, ...current];
  writeLearnCourseListCache(userId, next);
}

export function removeLearnCourseFromListCache(userId: string, courseId: string) {
  const current = readLearnCourseListCache(userId, { allowStale: true });
  if (!current) return;
  writeLearnCourseListCache(
    userId,
    current.filter((course) => course.id !== courseId),
  );
}
