'use client';

import {
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { CourseSpaceHeaderContent } from './course-space-header';
import { CourseSpaceContentLoading } from './course-space-content-loading';
import { CourseSpaceShellContext } from './course-space-shell-context';
import {
  readCourseSpaceHeaderCache,
  subscribeCourseSpaceHeaderCache,
} from '@/lib/course-space/course-space-header-cache';
import type { CourseSpaceRoute } from '@/lib/course-space/course-space-route';
import { resolveCourseSpaceHeaderFields } from '@/lib/course-space/format-course-space-header';
import { useAuthStore } from '@/lib/store/auth';

/** Lives in the root layout, above every course page and its loading boundary. */
export function CourseSpaceShell({
  route,
  children,
}: {
  route: CourseSpaceRoute;
  children: ReactNode;
}) {
  const { courseId, active, previewMode } = route;
  const portalRole = useAuthStore((state) => state.role);
  const subscribe = useCallback(
    (onChange: () => void) => subscribeCourseSpaceHeaderCache(courseId, onChange),
    [courseId],
  );
  const getSnapshot = useCallback(() => readCourseSpaceHeaderCache(courseId), [courseId]);
  const cachedHeader = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const role =
    route.role ??
    cachedHeader?.role ??
    (portalRole === 'TEACHER' || portalRole === 'ADMIN' ? 'teacher' : 'student');
  const headerFields = cachedHeader ?? resolveCourseSpaceHeaderFields({ id: courseId });
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [courseId, active]);

  return (
    <CourseSpaceShellContext.Provider value={true}>
      <div
        data-course-space-shell
        className="fixed inset-0 flex min-h-0 flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-white"
      >
        <div className="z-30 shrink-0 px-4 pt-4 sm:px-6 sm:pt-6 lg:px-12">
          <div className="mx-auto w-full max-w-[1536px]">
            <CourseSpaceHeaderContent
              courseId={courseId}
              courseTitle={headerFields.courseTitle}
              role={role}
              active={active}
              previewMode={previewMode}
            />
          </div>
        </div>
        <div
          ref={contentRef}
          data-course-space-content
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <Suspense fallback={<CourseSpaceContentLoading />}>{children}</Suspense>
        </div>
      </div>
    </CourseSpaceShellContext.Provider>
  );
}
