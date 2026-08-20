import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: '教师登录 · Syntara',
  description: '进入 Syntara 教师课程工作台。',
};

export default function TeacherLoginPage() {
  redirect('/speedup/signed-out?role=teacher');
}
