import type { LocalCourseSummary } from '../domain/models';
import type { PhoneLastChat } from './phone-last-chat';

export type CourseLearningPage = 'notes' | 'progress' | 'memory' | 'classroom' | 'problems';

export type CourseOpenTarget = {
  page: 'calendar' | CourseLearningPage;
  date?: string;
  createEvent?: boolean;
};

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
