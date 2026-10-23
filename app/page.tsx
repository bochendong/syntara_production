import type { Metadata } from 'next';

import { SyntaraLanding } from '@/components/home/landing/syntara-landing';

export const metadata: Metadata = {
  title: 'Syntara · 学过的，真的记得住',
  description: 'AI 笔记本、AI 课堂、题库练习、学习记忆和学习日历，网页和 iPhone 同步。',
};

export default function HomePage() {
  return <SyntaraLanding googleTest={process.env.SYNTARA_APP_ENV === 'staging'} />;
}
