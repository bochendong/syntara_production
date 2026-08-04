import { TeacherCourseStudioClient } from '@/components/teacher/teacher-course-studio-client';

export default async function TeacherCourseStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeacherCourseStudioClient courseId={id} />;
}
