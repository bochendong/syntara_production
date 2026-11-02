import type { Metadata } from 'next';
import { TeacherClassSessionClient } from '@/components/teacher/classroom/teacher-class-session-client';

export const metadata: Metadata = { title: '上课 · Syntara' };

export default async function TeacherClassSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <TeacherClassSessionClient sessionId={sessionId} />;
}
