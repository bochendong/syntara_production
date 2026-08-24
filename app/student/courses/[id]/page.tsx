import { StudentCoursePageClient } from '@/components/student/student-course-page-client';

export default async function StudentCoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mock?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <StudentCoursePageClient courseId={id} mockMode={query.mock === '1'} />;
}
