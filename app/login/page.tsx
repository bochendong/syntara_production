import type { Metadata } from 'next';
import { StudentOnlineLoginPage } from '@/components/auth/student-online-login-page';

export const metadata: Metadata = {
  title: '学生登录 · Syntara',
};

export default function LoginPage() {
  return <StudentOnlineLoginPage />;
}
