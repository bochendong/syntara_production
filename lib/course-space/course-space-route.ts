export type CourseSpaceRole = 'teacher' | 'student';
export type CourseSpaceSection =
  | 'dashboard'
  | 'resources'
  | 'chat'
  | 'problem-bank'
  | 'forum'
  | 'students';

export type CourseSpaceRoute = {
  courseId: string;
  active: CourseSpaceSection;
  /** Shared forum/bank routes inherit the current course role once it is known. */
  role: CourseSpaceRole | null;
  previewMode: boolean;
};

export function resolveCourseSpaceRoute(
  pathname: string | null,
  searchParams: Pick<URLSearchParams, 'get'>,
): CourseSpaceRoute | null {
  const previewMode = searchParams.get('mock') === '1' || searchParams.get('uiPreview') === '1';
  if (pathname === '/learn') {
    const courseId = searchParams.get('courseId')?.trim();
    if (!courseId) return null;
    return {
      courseId,
      active: 'chat',
      role:
        searchParams.get('asStudent') === '1'
          ? 'student'
          : searchParams.get('from') === 'teacher'
            ? 'teacher'
            : previewMode
              ? 'student'
              : null,
      previewMode,
    };
  }

  const teacher = pathname?.match(/^\/teacher\/courses\/([^/]+)(?:\/(students))?\/?$/);
  const student = pathname?.match(/^\/course\/([^/]+)(?:\/(resources|problem-bank|forum))?\/?$/);
  const match = teacher ?? student;
  if (!match) return null;
  let courseId: string;
  try {
    courseId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const active = (match[2] ?? (teacher ? 'resources' : 'dashboard')) as CourseSpaceSection;
  return {
    courseId,
    active,
    role: teacher
      ? 'teacher'
      : active === 'dashboard' || active === 'resources'
        ? 'student'
        : previewMode
          ? searchParams.get('asTeacher') === '1'
            ? 'teacher'
            : 'student'
          : null,
    previewMode,
  };
}
