import { TeacherCourseStudioClient } from '@/components/teacher/teacher-course-studio-client';

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
  return <TeacherCourseStudioClient courseId={id} mockMode={mockMode} />;
}
