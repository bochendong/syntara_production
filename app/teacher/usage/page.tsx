import type { Metadata } from 'next';
import { TeacherUsageAppClient } from '@/components/teacher/teacher-usage-app-client';

export const metadata: Metadata = {
  title: '用量统计 · Syntara',
  description: '查看教师端 AI 生成用量与质量评分。',
};

export default function TeacherUsagePage() {
  return <TeacherUsageAppClient />;
}
