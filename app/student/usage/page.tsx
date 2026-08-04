import type { Metadata } from 'next';
import { StudentUsageAppClient } from '@/components/student/student-usage-app-client';

export const metadata: Metadata = {
  title: '我的用量 · Syntara',
};

export default function StudentUsagePage() {
  return <StudentUsageAppClient />;
}
