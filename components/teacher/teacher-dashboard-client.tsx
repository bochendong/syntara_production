'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LearnHomeDashboard } from '@/components/learn/learn-home-dashboard';
import { useAuthSignOut } from '@/lib/hooks/use-auth-sign-out';
import type { CourseRecord } from '@/lib/utils/database';
import { backendJson } from '@/lib/utils/backend-api';
import { isLocalDemoUserId } from '@/lib/auth/local-demo';
import { LOCAL_DEMO_TEACHER_HOME_COURSES } from '@/lib/teacher/local-demo-fixtures';

export function TeacherDashboardClient({ mockMode = false }: { mockMode?: boolean }) {
  const router = useRouter();
  const signOut = useAuthSignOut();
  const { data: session, status: sessionStatus } = useSession();
  const hydrated = mockMode || sessionStatus !== 'loading';
  const isLoggedIn = mockMode || sessionStatus === 'authenticated';
  const role =
    mockMode || session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN'
      ? 'TEACHER'
      : 'STUDENT';
  const teacherId = mockMode ? 'local-demo-teacher-ui-mock' : session?.user?.id || '';
  const localDemo = mockMode || isLocalDemoUserId(teacherId);
  const [homeCourses, setHomeCourses] = useState<CourseRecord[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState('');

  const loadHomeCourses = useCallback(async () => {
    if (mockMode) {
      setHomeCourses(LOCAL_DEMO_TEACHER_HOME_COURSES);
      setHomeError('');
      setHomeLoading(false);
      return;
    }
    if (!teacherId) return;
    if (localDemo) {
      setHomeCourses(LOCAL_DEMO_TEACHER_HOME_COURSES);
      setHomeError('');
      setHomeLoading(false);
      return;
    }
    setHomeLoading(true);
    setHomeError('');
    try {
      const payload = await backendJson<{ courses: CourseRecord[] }>('/api/teacher/courses');
      setHomeCourses(payload.courses);
    } catch (loadError) {
      setHomeError(loadError instanceof Error ? loadError.message : '当学期课程读取失败');
    } finally {
      setHomeLoading(false);
    }
  }, [localDemo, mockMode, teacherId]);

  useEffect(() => {
    if (!hydrated) return;
    if (!mockMode && (!isLoggedIn || role !== 'TEACHER')) {
      router.replace('/speedup/signed-out?role=teacher');
      return;
    }
    void loadHomeCourses();
  }, [hydrated, isLoggedIn, loadHomeCourses, mockMode, role, router]);

  if (!hydrated || (!mockMode && (!isLoggedIn || role !== 'TEACHER'))) return null;

  return (
    <LearnHomeDashboard
      variant="teacher"
      courses={homeCourses}
      activeCourseId={null}
      coursesLoading={homeLoading}
      courseLoadError={homeError || null}
      onCreateCourse={() => {}}
      onOpenPastCourses={() => router.push('/teacher/past-courses')}
      onOpenUsage={() => router.push('/teacher/usage')}
      onOpenCalendar={() => router.push('/calendar')}
      onOpenCourse={(courseId) =>
        router.push(`/teacher/courses/${encodeURIComponent(courseId)}${mockMode ? '?mock=1' : ''}`)
      }
      onSignOut={signOut}
      onRetryCourseLoad={() => void loadHomeCourses()}
    />
  );
}
