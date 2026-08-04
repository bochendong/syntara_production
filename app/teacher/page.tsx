import type { Metadata } from 'next';
import { TeacherDashboardClient } from '@/components/teacher/teacher-dashboard-client';

export const metadata: Metadata = {
  title: '教师工作台 · Syntara',
};

export default function TeacherDashboardPage() {
  return <TeacherDashboardClient />;
}
