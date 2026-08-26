'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LEARN_HOME_PREVIEW_COURSES,
  LearnHomeDashboard,
} from '@/components/learn/learn-home-dashboard';
import { usePersistHydrated } from '@/lib/hooks/use-persist-hydrated';
import { useAuthSignOut } from '@/lib/hooks/use-auth-sign-out';
import { useAuthStore } from '@/lib/store/auth';
import { useCurrentCourseStore } from '@/lib/store/current-course';
import {
  readLearnCourseListCache,
  writeLearnCourseListCache,
} from '@/components/learn/learn-course-list-cache';
import { listCoursesOrThrow } from '@/lib/utils/course-storage';
import type { CourseRecord } from '@/lib/utils/database';

const HOME_ROUTE_PREFETCH_TARGETS = [
  '/student/usage',
  '/calendar',
  '/profile',
  '/settings',
] as const;

function getInitialHomeCourses(preview: boolean) {
  if (preview) return LEARN_HOME_PREVIEW_COURSES;
  return (
    readLearnCourseListCache(useAuthStore.getState().userId || 'anonymous', {
      allowStale: true,
    }) ?? []
  );
}

export function LearnHomePageClient({
  preview = false,
  forceStudentPortal = false,
}: {
  preview?: boolean;
  forceStudentPortal?: boolean;
}) {
  const router = useRouter();
  const signOut = useAuthSignOut();
  const authHydrated = usePersistHydrated(useAuthStore);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const role = useAuthStore((state) => state.role);
  const setCurrentCourse = useCurrentCourseStore((state) => state.setCurrentCourse);
  const initialCourses = useMemo(() => getInitialHomeCourses(preview), [preview]);
  const [courses, setCourses] = useState<CourseRecord[]>(initialCourses);
  const [coursesLoading, setCoursesLoading] = useState(!preview && initialCourses.length === 0);
  const [courseLoadError, setCourseLoadError] = useState<string | null>(null);

  const loadCourses = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setCoursesLoading(true);
      setCourseLoadError(null);
    }
    try {
      const items = await listCoursesOrThrow();
      setCourses(items);
      writeLearnCourseListCache(useAuthStore.getState().userId || 'anonymous', items);
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
    void loadCourses({ silent: initialCourses.length > 0 }).catch(() => {
      if (!alive) return;
    });

    return () => {
      alive = false;
    };
  }, [
    authHydrated,
    forceStudentPortal,
    initialCourses.length,
    isLoggedIn,
    loadCourses,
    preview,
    role,
    router,
  ]);

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
      onOpenForum={() => router.push('/forum')}
      onSignOut={signOut}
      onRetryCourseLoad={() => void loadCourses().catch(() => {})}
    />
  );
}
