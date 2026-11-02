import type { Metadata } from 'next';
import { TeacherClassClient } from '@/components/teacher/classroom/teacher-class-client';

export const metadata: Metadata = { title: '班级 · Syntara' };

export default async function TeacherClassPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  return <TeacherClassClient classId={classId} />;
}
