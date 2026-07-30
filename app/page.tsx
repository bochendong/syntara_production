import type { Metadata } from 'next';

import LoginPage from '@/app/login/page';

export const metadata: Metadata = {
  title: '登录 Syntara',
  description: '登录后进入你的课程、课堂讲解、复习计划与学习记忆。',
};

export default function HomePage() {
  return <LoginPage />;
}
