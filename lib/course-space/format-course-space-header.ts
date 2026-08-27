import { academicTermLabel } from '@/lib/teacher/online-course-studio';
import { findLocalDemoTeacherHomeCourse } from '@/lib/teacher/local-demo-fixtures';
import type { AcademicTerm } from '@/lib/utils/database';

export const COURSE_SPACE_HEADER_SURFACE_CLASS =
  'overflow-hidden rounded-[16px] border border-slate-200/80 shadow-[0_8px_22px_rgba(15,23,42,0.035)] dark:border-white/10';

export const COURSE_SPACE_BODY_SURFACE_CLASS =
  'overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/95 shadow-[0_12px_32px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-slate-950/95';

type CourseSpaceHeaderCourse = {
  id?: string | null;
  code?: string | null;
  courseCode?: string | null;
  name?: string | null;
  academicYear?: number | null;
  term?: AcademicTerm | null;
  academicTerm?: AcademicTerm | null;
};

function withLocalDemoCourseHeaderFields(course: CourseSpaceHeaderCourse): CourseSpaceHeaderCourse {
  if (!course.id) return course;

  const demoCourse = findLocalDemoTeacherHomeCourse(course.id);
  if (!demoCourse) return course;

  const code =
    course.courseCode?.trim() || course.code?.trim() || demoCourse.courseCode?.trim() || undefined;
  const rawName = course.name?.trim();
  const demoName = demoCourse.name?.trim();
  const name =
    rawName && code && rawName.toUpperCase() !== code.toUpperCase() ? rawName : demoName || rawName;

  return {
    ...course,
    courseCode: course.courseCode ?? demoCourse.courseCode,
    code: course.code ?? demoCourse.courseCode,
    name,
    academicYear: course.academicYear ?? demoCourse.academicYear,
    academicTerm: course.academicTerm ?? demoCourse.academicTerm,
    term: course.term ?? demoCourse.academicTerm,
  };
}

function courseSpaceCode(course: CourseSpaceHeaderCourse): string {
  return course.code?.trim() || course.courseCode?.trim() || course.name?.trim() || '课程';
}

export function formatCourseSpaceTitle(course: CourseSpaceHeaderCourse): string {
  const code = courseSpaceCode(course);
  const term = course.term ?? course.academicTerm;
  const parts: string[] = [code];

  if (course.academicYear && term) {
    parts.push(`${course.academicYear} ${academicTermLabel(term)}`);
  } else if (course.academicYear) {
    parts.push(String(course.academicYear));
  } else if (term) {
    parts.push(academicTermLabel(term));
  }

  return parts.join(' · ');
}

export function formatCourseSpaceMeta(
  course: Pick<CourseSpaceHeaderCourse, 'name' | 'courseCode' | 'code'>,
): string | undefined {
  const name = course.name?.trim();
  if (!name) return undefined;

  const code = course.code?.trim() || course.courseCode?.trim();
  if (code && name.toUpperCase() === code.toUpperCase()) return undefined;

  return name;
}

export function resolveCourseSpaceHeaderFields(course: CourseSpaceHeaderCourse): {
  courseTitle: string;
  courseMeta?: string;
} {
  const resolvedCourse = withLocalDemoCourseHeaderFields(course);

  return {
    courseTitle: formatCourseSpaceTitle(resolvedCourse),
    courseMeta: formatCourseSpaceMeta(resolvedCourse),
  };
}
