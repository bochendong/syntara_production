import type { Metadata } from 'next';
import { MiniLectureParityMock } from '@/features/qa/test-center/mini-lecture/mini-lecture-parity-mock';

export const metadata: Metadata = {
  title: '小课堂 Web / App 视觉一致性测试',
  description: '验证 Web 小课堂工作区是否与 App 视觉一致。',
};

export default function MiniLectureParityPage() {
  return <MiniLectureParityMock />;
}
