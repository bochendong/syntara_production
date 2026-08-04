import type { Metadata } from 'next';

import { AdminEntry } from '@/components/admin/admin-entry';

export const metadata: Metadata = {
  title: '管理员控制台 · Syntara',
  description: '管理学生、老师、课程和全站 AI 配置。',
};

export default function AdminPage() {
  return <AdminEntry />;
}
