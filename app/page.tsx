import type { Metadata } from 'next';

import { SyntaraLanding } from '@/components/home/landing/syntara-landing';

export const metadata: Metadata = {
  title: 'Syntara · 上课没听懂，下课接着问',
  description: '上传课程讲义，提问、看讲解、做题。把想再看的内容记下来，作业和考试放进同一张日历。',
};

export default function HomePage() {
  return <SyntaraLanding googleTest={process.env.SYNTARA_APP_ENV === 'staging'} />;
}
