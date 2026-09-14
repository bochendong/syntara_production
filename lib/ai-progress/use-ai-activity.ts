'use client';

import { notifyTaskResult } from '@/lib/notifications/task-notifications';
import { useEffect, useId } from 'react';
import { useSession } from 'next-auth/react';
import { backendJson, BackendApiError } from '@/lib/utils/backend-api';
import { useAiActivityStore } from '@/lib/store/ai-activity';
import { useAiTaskQueueStore } from '@/lib/store/ai-task-queue';

/** Each producer owns a token, so concurrent requests cannot clear each other. */
export function useReportAiActivity(active: boolean) {
  const id = useId();
  useEffect(() => {
    useAiActivityStore.getState().report(id, active);
    return () => useAiActivityStore.getState().report(id, false);
  }, [id, active]);
}

export function useAiActivity() {
  const { data: session } = useSession();
  const ownerId = session?.user?.id;
  const queued = useAiTaskQueueStore((state) =>
    state.tasks.some((task) => task.status === 'queued' || task.status === 'running'),
  );
  const local = useAiActivityStore((state) => Object.values(state.sources).some(Boolean));
  const remote = useAiActivityStore((state) =>
    Object.values(state.teacherCourses).some(
      (course) => course.ownerId === ownerId && course.active,
    ),
  );

  const miniLecture = useAiActivityStore((state) =>
    Object.values(state.miniLectures).some((owner) => owner === ownerId),
  );
  useEffect(() => {
    if (!ownerId || (!remote && !miniLecture)) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (disposed || refreshing || document.visibilityState !== 'visible') return;
      const pending = Object.values(useAiActivityStore.getState().teacherCourses).filter(
        (course) =>
          course.ownerId === ownerId && course.active && Date.now() - course.checkedAt > 8000,
      );
      const miniJobs = Object.entries(useAiActivityStore.getState().miniLectures).filter(
        ([, owner]) => owner === ownerId,
      );
      if (!pending.length && !miniJobs.length) return;
      refreshing = true;
      try {
        const { loadOnlineTeacherStudio } = await import('@/lib/teacher/online-course-studio');
        if (disposed) return;
        await Promise.allSettled([
          ...pending.map(async (course) => {
            try {
              await loadOnlineTeacherStudio({ teacherId: ownerId, courseId: course.courseId });
            } catch (error) {
              if (error instanceof BackendApiError && [401, 403, 404].includes(error.status ?? 0))
                useAiActivityStore.getState().teacherSnapshot(ownerId, course.courseId, false);
            }
          }),
          ...miniJobs.map(async ([id]) => {
            try {
              const result = await backendJson<{ job: { status: string } }>(
                `/api/learn/mini-lectures?id=${encodeURIComponent(id)}`,
              );
              if (['completed', 'failed', 'cancelled'].includes(result.job.status)) {
                notifyTaskResult({
                  id: `mini:${id}`,
                  title: '课堂讲解',
                  status: result.job.status,
                  ownerId,
                  href: '/learn',
                });
                useAiActivityStore.getState().miniLecture(id, ownerId, false);
              }
            } catch (error) {
              if (error instanceof BackendApiError && [401, 403, 404].includes(error.status ?? 0))
                useAiActivityStore.getState().miniLecture(id, ownerId, false);
            }
          }),
        ]);
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [ownerId, remote, miniLecture]);

  return queued || local || remote || miniLecture;
}

/** Recover server-side teacher work when opening chat or another course section directly. */
export function useObserveTeacherAiTasks(courseId: string, enabled: boolean) {
  const { data: session } = useSession();
  const ownerId = session?.user?.id;
  useEffect(() => {
    if (!enabled || !ownerId) return;
    let disposed = false;
    const load = async () => {
      const { loadOnlineTeacherStudio } = await import('@/lib/teacher/online-course-studio');
      if (!disposed)
        await loadOnlineTeacherStudio({ courseId, teacherId: ownerId }).catch(() => undefined);
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [courseId, enabled, ownerId]);
}
