const avatarModules = import.meta.glob('../../../public/avatars/course-avators/*.avif', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function avatarFilename(path: string): string {
  return path.split('/').pop() || path;
}

export type CourseAvatarPreset = {
  id: string;
  url: string;
};

export const COURSE_AVATAR_PRESETS: CourseAvatarPreset[] = Object.entries(avatarModules)
  .filter(([path]) => !avatarFilename(path).includes('(1)'))
  .map(([path, url]) => ({ id: avatarFilename(path), url }))
  .sort((left, right) => left.id.localeCompare(right.id, 'en'));

const courseAvatarByCode: Record<string, string> = {
  CSC148: COURSE_AVATAR_PRESETS.find((item) => item.id === 'SR2.avif')?.url || COURSE_AVATAR_PRESETS[0]?.url || '',
  MAT136:
    COURSE_AVATAR_PRESETS.find((item) => item.id === '767dee2c02f7954b500a9ec416d38e5b.avif')?.url ||
    COURSE_AVATAR_PRESETS[0]?.url ||
    '',
};

const defaultCourseAvatarUrl =
  COURSE_AVATAR_PRESETS.find((item) => item.id === 'R14.avif')?.url ||
  COURSE_AVATAR_PRESETS[0]?.url ||
  '';

export function courseAvatarStorageKey(courseId: string): string {
  return `syntara.native.course.${courseId}.avatar`;
}

export function readStoredCourseAvatarId(courseId: string): string | null {
  try {
    return window.localStorage.getItem(courseAvatarStorageKey(courseId));
  } catch {
    return null;
  }
}

export function writeStoredCourseAvatarId(courseId: string, avatarId: string | null): void {
  try {
    if (!avatarId) {
      window.localStorage.removeItem(courseAvatarStorageKey(courseId));
      return;
    }
    window.localStorage.setItem(courseAvatarStorageKey(courseId), avatarId);
    window.dispatchEvent(new Event('syntara-native-course-avatar-changed'));
  } catch {
    // Ignore storage failures; UI can still preview the selected avatar for this session.
  }
}

export function courseAvatarUrlById(avatarId: string | null | undefined): string | null {
  if (!avatarId) return null;
  return COURSE_AVATAR_PRESETS.find((item) => item.id === avatarId)?.url || null;
}

export function pickRandomCourseAvatarId(): string {
  if (!COURSE_AVATAR_PRESETS.length) return 'R14.avif';
  const index = Math.floor(Math.random() * COURSE_AVATAR_PRESETS.length);
  return COURSE_AVATAR_PRESETS[index].id;
}

export function courseAvatarFor(courseCode: string | null): string {
  return (courseCode && courseAvatarByCode[courseCode.toUpperCase()]) || defaultCourseAvatarUrl;
}

export function resolveNativeCourseAvatar(
  courseId: string,
  courseCode: string | null,
  avatarId?: string | null,
): string {
  const resolvedId = avatarId ?? readStoredCourseAvatarId(courseId);
  return courseAvatarUrlById(resolvedId) || courseAvatarFor(courseCode);
}
