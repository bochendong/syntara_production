'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LEARN_HOME_PREVIEW_COURSES,
  LearnHomeDashboard,
} from '@/components/learn/learn-home-dashboard';
import {
  readLearnCourseListCache,
  writeLearnCourseListCache,
} from '@/components/learn/learn-course-list-cache';
import { usePersistHydrated } from '@/lib/hooks/use-persist-hydrated';
import { useAuthStore } from '@/lib/store/auth';
import { useCurrentCourseStore } from '@/lib/store/current-course';
import { listCoursesOrThrow } from '@/lib/utils/course-storage';
import type { CourseRecord } from '@/lib/utils/database';

const CreateCourseDialog = dynamic(
  () => import('@/components/courses/create-course-dialog').then((mod) => mod.CreateCourseDialog),
  { ssr: false },
);

const HOME_ROUTE_PREFETCH_TARGETS = ['/calendar', '/profile', '/settings'] as const;

export function LearnHomePageClient({ preview = false }: { preview?: boolean }) {
  const router = useRouter();
  const authHydrated = usePersistHydrated(useAuthStore);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const userId = useAuthStore((state) => state.userId);
  const setCurrentCourse = useCurrentCourseStore((state) => state.setCurrentCourse);
  const localUserId = userId || 'anonymous';
  const [courses, setCourses] = useState<CourseRecord[]>(preview ? LEARN_HOME_PREVIEW_COURSES : []);
  const [coursesLoading, setCoursesLoading] = useState(!preview);
  const [courseLoadError, setCourseLoadError] = useState<string | null>(null);
  const [createCourseOpen, setCreateCourseOpen] = useState(false);

  const loadCourses = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setCoursesLoading(true);
        setCourseLoadError(null);
      }
      try {
        const items = await listCoursesOrThrow();
        writeLearnCourseListCache(localUserId, items);
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
    },
    [localUserId],
  );

  useEffect(() => {
    if (preview || !authHydrated) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }

    let alive = true;
    const cachedCourses = readLearnCourseListCache(localUserId, { allowStale: true });
    if (cachedCourses?.length) {
      setCourses(cachedCourses);
      setCoursesLoading(false);
      void loadCourses({ silent: true }).catch(() => {});
      return () => {
        alive = false;
      };
    }

    void loadCourses().catch(() => {
      if (!alive) return;
    });

    return () => {
      alive = false;
    };
  }, [authHydrated, isLoggedIn, loadCourses, localUserId, preview, router]);

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

  const refreshCourses = useCallback(async () => {
    await loadCourses();
  }, [loadCourses]);

  const openCourse = useCallback(
    (courseId: string) => {
      const course = courses.find((item) => item.id === courseId);
      if (course) {
        setCurrentCourse({ id: course.id, name: course.name, avatarUrl: course.avatarUrl });
      }
      router.push(`/learn?courseId=${encodeURIComponent(courseId)}`);
    },
    [courses, router, setCurrentCourse],
  );

  return (
    <>
      <LearnHomeDashboard
        courses={preview ? LEARN_HOME_PREVIEW_COURSES : courses}
        activeCourseId={null}
        coursesLoading={coursesLoading}
        courseLoadError={courseLoadError}
        onCreateCourse={() => setCreateCourseOpen(true)}
        onOpenCalendar={() => router.push('/calendar')}
        onOpenCourse={openCourse}
        onRetryCourseLoad={() => void loadCourses().catch(() => {})}
      />
      {createCourseOpen ? (
        <CreateCourseDialog
          open
          onOpenChange={setCreateCourseOpen}
          onSuccess={() => void refreshCourses().catch(() => {})}
        />
      ) : null}
    </>
  );
}
