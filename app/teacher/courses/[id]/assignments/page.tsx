import { CourseAssignmentsClient } from '@/components/course-space/course-assignments-client';
import { CourseAccessClosedCard } from '@/components/course-access-closed-card';
import { currentCoursePageAccess } from '@/lib/server/current-course-page-access';

export const metadata = { title: '作业 · Syntara' };

export default async function TeacherCourseAssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mock?: string }>;
}) {
  const { id } = await params;
  const previewMode = (await searchParams).mock === '1';
  if (!previewMode && (await currentCoursePageAccess(id)) === null) {
    return <CourseAccessClosedCard returnHref="/teacher" returnLabel="返回教师工作台" />;
  }
  return <CourseAssignmentsClient courseId={id} role="teacher" previewMode={previewMode} />;
}
