import { StudentCoursePageClient } from '@/components/student/student-course-page-client';

export default async function StudentCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentCoursePageClient courseId={id} />;
}
