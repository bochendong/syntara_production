import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: '学生登录 · Syntara',
  description: '学生登录后进入课程、AI 笔记本与学习日历。',
};

export default function HomePage() {
  return redirect('/speedup/signed-out?role=student');
}
