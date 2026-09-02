const COURSE_SPACE_HEADER_CACHE_PREFIX = 'syntara:course-space-header:v1:';
const COURSE_SPACE_HEADER_CACHE_EVENT = 'syntara:course-space-header-cache-change';

type CachedCourseSpaceRole = 'teacher' | 'student';

export type CourseSpaceHeaderCacheEntry = {
  courseId: string;
  courseTitle: string;
  courseMeta?: string;
  courseAvatarUrl?: string | null;
  role: CachedCourseSpaceRole;
  problemCount?: number;
  forumCount?: number;
};

const PLACEHOLDER_TITLES = new Set(['', '课程', '课程论坛', '题库', 'Course', 'Course forum']);
const memoryCache = new Map<string, CourseSpaceHeaderCacheEntry | null>();

export function isCourseSpaceHeaderPlaceholder(courseTitle: string): boolean {
  return PLACEHOLDER_TITLES.has(courseTitle.trim());
}

function cacheKey(courseId: string): string {
  return `${COURSE_SPACE_HEADER_CACHE_PREFIX}${courseId}`;
}

export function readCourseSpaceHeaderCache(courseId: string): CourseSpaceHeaderCacheEntry | null {
  if (typeof window === 'undefined' || !courseId) return null;
  if (memoryCache.has(courseId)) return memoryCache.get(courseId) ?? null;
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(cacheKey(courseId)) || 'null',
    ) as Partial<CourseSpaceHeaderCacheEntry> | null;
    if (
      !parsed ||
      parsed.courseId !== courseId ||
      typeof parsed.courseTitle !== 'string' ||
      isCourseSpaceHeaderPlaceholder(parsed.courseTitle) ||
      (parsed.role !== 'teacher' && parsed.role !== 'student')
    ) {
      memoryCache.set(courseId, null);
      return null;
    }
    const entry: CourseSpaceHeaderCacheEntry = {
      courseId,
      courseTitle: parsed.courseTitle,
      courseMeta: typeof parsed.courseMeta === 'string' ? parsed.courseMeta : undefined,
      courseAvatarUrl:
        typeof parsed.courseAvatarUrl === 'string' || parsed.courseAvatarUrl === null
          ? parsed.courseAvatarUrl
          : undefined,
      role: parsed.role,
      problemCount: typeof parsed.problemCount === 'number' ? parsed.problemCount : undefined,
      forumCount: typeof parsed.forumCount === 'number' ? parsed.forumCount : undefined,
    };
    memoryCache.set(courseId, entry);
    return entry;
  } catch {
    memoryCache.set(courseId, null);
    return null;
  }
}

export function subscribeCourseSpaceHeaderCache(
  courseId: string,
  onStoreChange: () => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handleChange = (event: Event) => {
    if ((event as CustomEvent<{ courseId?: string }>).detail?.courseId === courseId) {
      onStoreChange();
    }
  };
  window.addEventListener(COURSE_SPACE_HEADER_CACHE_EVENT, handleChange);
  return () => window.removeEventListener(COURSE_SPACE_HEADER_CACHE_EVENT, handleChange);
}

export function writeCourseSpaceHeaderCache(entry: CourseSpaceHeaderCacheEntry): void {
  if (
    typeof window === 'undefined' ||
    !entry.courseId ||
    isCourseSpaceHeaderPlaceholder(entry.courseTitle)
  ) {
    return;
  }
  try {
    memoryCache.set(entry.courseId, entry);
    window.sessionStorage.setItem(cacheKey(entry.courseId), JSON.stringify(entry));
    window.dispatchEvent(
      new CustomEvent(COURSE_SPACE_HEADER_CACHE_EVENT, {
        detail: { courseId: entry.courseId },
      }),
    );
  } catch {
    // The shared header still works when storage is unavailable; only transition continuity is lost.
  }
}
