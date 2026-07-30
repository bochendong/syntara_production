import type { Metadata } from 'next';
import { MarkdownReaderParityMock } from '@/features/qa/test-center/markdown-reader/markdown-reader-parity-mock';

export const metadata: Metadata = {
  title: '笔记本阅读器 Web / App 视觉一致性测试',
  description: '验证 Web Markdown 笔记本阅读器是否与 App 视觉一致。',
};

export default function MarkdownReaderParityPage() {
  return <MarkdownReaderParityMock />;
}
