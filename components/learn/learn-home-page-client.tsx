'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  LEARN_HOME_PREVIEW_COURSES,
  LearnHomeDashboard,
} from '@/components/learn/learn-home-dashboard';
import { useAuthSignOut } from '@/lib/hooks/use-auth-sign-out';
import { useCurrentCourseStore } from '@/lib/store/current-course';
import { listCoursesOrThrow } from '@/lib/utils/course-storage';
import type { CourseRecord } from '@/lib/utils/database';

const HOME_ROUTE_PREFETCH_TARGETS = [
  '/student/usage',
  '/calendar',
  '/profile',
  '/settings',
] as const;

export function LearnHomePageClient({
  preview = false,
  forceStudentPortal = false,
}: {
  preview?: boolean;
  forceStudentPortal?: boolean;
}) {
  const router = useRouter();
  const signOut = useAuthSignOut();
  const { data: session, status: sessionStatus } = useSession();
  const authHydrated = preview || forceStudentPortal || sessionStatus !== 'loading';
  const isLoggedIn = preview || forceStudentPortal || sessionStatus === 'authenticated';
  const role =
    !preview &&
    !forceStudentPortal &&
    (session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN')
      ? session.user.role
      : 'STUDENT';
  const setCurrentCourse = useCurrentCourseStore((state) => state.setCurrentCourse);
  const [courses, setCourses] = useState<CourseRecord[]>(preview ? LEARN_HOME_PREVIEW_COURSES : []);
  const [coursesLoading, setCoursesLoading] = useState(!preview);
  const [courseLoadError, setCourseLoadError] = useState<string | null>(null);

  const loadCourses = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setCoursesLoading(true);
      setCourseLoadError(null);
    }
    try {
      const items = await listCoursesOrThrow();
      setCourses(items);
      return items;
    } catch (error) {
      if (!options.silent) {
        setCourseLoadError(error instanceof Error ? error.message : '课程加载失败');
      }
      throw error;
    } finally {
      if (!options.silent) setCoursesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (preview || !authHydrated) return;
    if (!isLoggedIn && !forceStudentPortal) {
      router.replace('/speedup/signed-out?role=student');
      return;
    }
    if (role !== 'STUDENT' && !forceStudentPortal) {
      router.replace('/teacher');
      return;
    }

    let alive = true;
    void loadCourses().catch(() => {
      if (!alive) return;
    });

    return () => {
      alive = false;
    };
  }, [authHydrated, forceStudentPortal, isLoggedIn, loadCourses, preview, role, router]);

  useEffect(() => {
    if (preview || (!isLoggedIn && !forceStudentPortal)) return;
    const refresh = () => void loadCourses({ silent: true }).catch(() => undefined);
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [forceStudentPortal, isLoggedIn, loadCourses, preview]);

  useEffect(() => {
    if (preview) return;
    const prefetchHomeDestinations = () => {
      HOME_ROUTE_PREFETCH_TARGETS.forEach((href) => router.prefetch(href));
    };
    const idleWindow = window as unknown as {
      requestIdleCallback?: typeof window.requestIdleCallback;
      cancelIdleCallback?: typeof window.cancelIdleCallback;
    };
    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(prefetchHomeDestinations, { timeout: 1_500 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timerId = window.setTimeout(prefetchHomeDestinations, 600);
    return () => window.clearTimeout(timerId);
  }, [preview, router]);

  const openCourse = useCallback(
    (courseId: string) => {
      const course = courses.find((item) => item.id === courseId);
      if (course) {
        setCurrentCourse({ id: course.id, name: course.name, avatarUrl: course.avatarUrl });
      }
      const params = new URLSearchParams({ courseId });
      if (forceStudentPortal || preview) params.set('asStudent', '1');
      if (preview) params.set('uiPreview', '1');
      router.push(`/learn?${params.toString()}`);
    },
    [courses, forceStudentPortal, preview, router, setCurrentCourse],
  );

  return (
    <LearnHomeDashboard
      courses={preview ? LEARN_HOME_PREVIEW_COURSES : courses}
      activeCourseId={null}
      coursesLoading={coursesLoading}
      courseLoadError={courseLoadError}
      onCreateCourse={() => {}}
      onOpenCalendar={() => router.push('/calendar')}
      onOpenUsage={() => router.push('/student/usage')}
      onOpenCourse={openCourse}
      onSignOut={signOut}
      onRetryCourseLoad={() => void loadCourses().catch(() => {})}
    />
  );
}
