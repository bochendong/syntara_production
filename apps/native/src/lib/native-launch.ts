import type { LocalCourseSummary } from '../domain/models';
import type { PhoneLastChat } from './phone-last-chat';

export type CourseLearningPage =
  | 'materials'
  | 'notes'
  | 'progress'
  | 'memory'
  | 'classroom'
  | 'problems';

export type CourseOpenTarget = {
  page: 'calendar' | CourseLearningPage;
  date?: string;
  createEvent?: boolean;
};

/** Read only identifiers. A link never grants access to its course or question. */
export function practiceEntry(params: URLSearchParams | null) {
  const courseId = params?.get('courseId');
  const problemId = params?.get('problemId');
  const id = /^[A-Za-z0-9_-]{1,200}$/;
  return courseId && problemId && id.test(courseId) && id.test(problemId)
    ? { courseId, problemId }
    : null;
}

export function carryPracticeEntry(path: string, search: string) {
  const target = practiceEntry(new URLSearchParams(search));
  if (!target) return path;
  const separator = path.includes('?') ? '&' : '?';
  return path + separator + new URLSearchParams(target);
}

/** An explicitly empty membership must never expose courses left in the local cache. */
export function accessibleChatCourses<T extends Pick<LocalCourseSummary, 'id'>>(
  courses: T[],
  platformCourseIds: string[] | null,
  browserPreview: boolean,
): T[] {
  if (platformCourseIds === null) return browserPreview ? courses : [];
  const allowedIds = new Set(platformCourseIds);
  return courses.filter((course) => allowedIds.has(course.id));
}

/** Launch into the last accessible course, otherwise the most recently updated course. */
export function selectChatCourse<T extends Pick<LocalCourseSummary, 'id' | 'updatedAt'>>(
  courses: T[],
  lastChat: PhoneLastChat | null,
): T | null {
  return (
    courses.find((course) => course.id === lastChat?.courseId) ??
    [...courses].sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
    null
  );
}
