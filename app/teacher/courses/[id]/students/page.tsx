import type { Metadata } from 'next';
import { TeacherCourseStudentsClient } from '@/components/teacher/teacher-course-students-client';

export const metadata: Metadata = {
  title: '学生管理 · Syntara',
  description: '管理课程学生名单与访问资格。',
};

export default async function TeacherCourseStudentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeacherCourseStudentsClient courseId={id} />;
}
