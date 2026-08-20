import type { Metadata } from 'next';
import { CourseAccessClosedCard } from '@/components/course-access-closed-card';
import { TeacherCourseStudentsClient } from '@/components/teacher/teacher-course-students-client';
import { currentCoursePageAccess } from '@/lib/server/current-course-page-access';

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
  if ((await currentCoursePageAccess(id)) === null) {
    return <CourseAccessClosedCard returnHref="/teacher" returnLabel="返回教师工作台" />;
  }
  return <TeacherCourseStudentsClient courseId={id} />;
}
