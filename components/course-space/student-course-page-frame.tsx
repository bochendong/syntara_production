import type { ReactNode } from 'react';
import { CourseSpaceHeader, resolveCourseSpaceHeaderFields } from './course-space-header';
import { CourseSpacePageFrame } from './course-space-page-frame';
import type { CourseRecord } from '@/lib/utils/database';

export function StudentCoursePageFrame({
  courseId,
  course,
  active,
  children,
}: {
  courseId: string;
  course?: CourseRecord | null;
  active: 'dashboard' | 'resources';
  children?: ReactNode;
}) {
  return (
    <CourseSpacePageFrame>
      <CourseSpaceHeader
        courseId={courseId}
        {...resolveCourseSpaceHeaderFields(course ?? { id: courseId })}
        courseAvatarUrl={course?.avatarUrl}
        role="student"
        active={active}
      />
      <main className="flex min-h-0 flex-1 flex-col gap-4">{children}</main>
    </CourseSpacePageFrame>
  );
}
