import { TeacherCourseStudentDetailClient } from '@/components/teacher/teacher-course-student-detail-client';

export default async function TeacherCourseStudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; studentId: string }>;
  searchParams: Promise<{ mock?: string }>;
}) {
  const { id, studentId } = await params;
  const query = await searchParams;
  return (
    <TeacherCourseStudentDetailClient
      courseId={id}
      studentId={studentId}
      mockMode={query.mock === '1'}
    />
  );
}
