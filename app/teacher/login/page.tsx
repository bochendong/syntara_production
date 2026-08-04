import type { Metadata } from 'next';
import { TeacherOnlineLoginPage } from '@/components/auth/teacher-online-login-page';

export const metadata: Metadata = {
  title: '教师登录 · Syntara',
  description: '进入 Syntara 教师课程工作台。',
};

export default function TeacherLoginPage() {
  return <TeacherOnlineLoginPage />;
}
