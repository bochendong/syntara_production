import type { Metadata } from 'next';

import { AdminEntry } from '@/components/admin/admin-entry';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return {
    title:
      process.env.SYNTARA_APP_ENV === 'staging'
        ? '测试服管理员控制台 · Syntara'
        : '管理员控制台 · Syntara',
    description: '管理学生、老师、课程和 AI 配置。',
    robots: { index: false, follow: false },
  };
}

export default function AdminPage() {
  return <AdminEntry staging={process.env.SYNTARA_APP_ENV === 'staging'} />;
}
