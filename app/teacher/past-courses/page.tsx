import type { Metadata } from 'next';
import { TeacherPastCoursesAppClient } from '@/components/teacher/teacher-past-courses-app-client';

export const metadata: Metadata = {
  title: '往届课程 · Syntara',
  description: '按学期查看本届与往届课程，并按需迁移往届课程内容。',
};

export default function TeacherPastCoursesPage() {
  return <TeacherPastCoursesAppClient />;
}
