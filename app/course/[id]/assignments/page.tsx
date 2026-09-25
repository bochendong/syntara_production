import { CourseAssignmentsClient } from '@/components/course-space/course-assignments-client';
import { CourseAccessClosedCard } from '@/components/course-access-closed-card';
import { currentCoursePageAccess } from '@/lib/server/current-course-page-access';

export const metadata = { title: '作业 · Syntara' };

export default async function StudentCourseAssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mock?: string }>;
}) {
  const { id } = await params;
  const previewMode = (await searchParams).mock === '1';
  if (!previewMode && (await currentCoursePageAccess(id)) === null) {
    return <CourseAccessClosedCard returnHref="/learn" returnLabel="返回课程" />;
  }
  return <CourseAssignmentsClient courseId={id} role="student" previewMode={previewMode} />;
}
