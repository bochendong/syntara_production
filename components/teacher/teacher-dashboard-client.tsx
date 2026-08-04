'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LearnHomeDashboard } from '@/components/learn/learn-home-dashboard';
import { useAuthSignOut } from '@/lib/hooks/use-auth-sign-out';
import type { CourseRecord } from '@/lib/utils/database';
import { backendJson } from '@/lib/utils/backend-api';

export function TeacherDashboardClient() {
  const router = useRouter();
  const signOut = useAuthSignOut();
  const { data: session, status: sessionStatus } = useSession();
  const hydrated = sessionStatus !== 'loading';
  const isLoggedIn = sessionStatus === 'authenticated';
  const role =
    session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN' ? 'TEACHER' : 'STUDENT';
  const teacherId = session?.user?.id || '';
  const [homeCourses, setHomeCourses] = useState<CourseRecord[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState('');

  const loadHomeCourses = useCallback(async () => {
    if (!teacherId) return;
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
  }, [teacherId]);

  useEffect(() => {
    if (!hydrated) return;
    if (!isLoggedIn || role !== 'TEACHER') {
      router.replace('/teacher/login');
      return;
    }
    void loadHomeCourses();
  }, [hydrated, isLoggedIn, loadHomeCourses, role, router]);

  if (!hydrated || !isLoggedIn || role !== 'TEACHER') return null;

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
      onOpenCourse={(courseId) => router.push(`/teacher/courses/${encodeURIComponent(courseId)}`)}
      onSignOut={signOut}
      onRetryCourseLoad={() => void loadHomeCourses()}
    />
  );
}
