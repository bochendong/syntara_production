import type { Metadata } from 'next';
import { NotebookLibraryParityMock } from '@/features/qa/test-center/notebook-library/notebook-library-parity-mock';

export const metadata: Metadata = {
  title: '笔记本库 Web / App 视觉一致性测试',
  description: '验证 Web 笔记本卡片是否与 App 视觉一致。',
};

export default function NotebookLibraryParityPage() {
  return <NotebookLibraryParityMock />;
}
