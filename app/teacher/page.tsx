import type { Metadata } from 'next';
import { TeacherDashboardClient } from '@/components/teacher/teacher-dashboard-client';

export const metadata: Metadata = {
  title: '教师工作台 · Syntara',
};

export default async function TeacherDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mock?: string }>;
}) {
  const query = await searchParams;
  const mockMode = query.mock === '1';
  return <TeacherDashboardClient mockMode={mockMode} />;
}
