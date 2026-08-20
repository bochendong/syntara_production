import { TeacherCourseStudioClient } from '@/components/teacher/teacher-course-studio-client';
import { CourseAccessClosedCard } from '@/components/course-access-closed-card';
import { currentCoursePageAccess } from '@/lib/server/current-course-page-access';

export default async function TeacherCourseStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mock?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const mockMode = query.mock === '1';
  if (!mockMode && (await currentCoursePageAccess(id)) === null) {
    return <CourseAccessClosedCard returnHref="/teacher" returnLabel="返回教师工作台" />;
  }
  return <TeacherCourseStudioClient courseId={id} mockMode={mockMode} />;
}
