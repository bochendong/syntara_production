import type { Metadata } from 'next';

import { SyntaraLanding } from '@/components/home/landing/syntara-landing';

export const metadata: Metadata = {
  title: 'Syntara · 课件变笔记，错题有人记',
  description: '上传课件，生成笔记、小课堂和练习题，记下你的错题。网页和 iPhone 同步。',
};

export default function HomePage() {
  return <SyntaraLanding googleTest={process.env.SYNTARA_APP_ENV === 'staging'} />;
}
