import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TeacherSpeedupCoursesClient } from '@/components/teacher/teacher-speedup-courses-client';

export const metadata: Metadata = {
  title: '开通 Speedup 课程 · Syntara',
  description: '选择本学期允许开通 AI 的 Speedup 课程。',
};

export default function TeacherSpeedupCoursesPage() {
  return (
    <Suspense fallback={null}>
      <TeacherSpeedupCoursesClient />
    </Suspense>
  );
}
