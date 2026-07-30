import type { Metadata } from 'next';
import { Mat136ReviewPlanMock } from '@/features/qa/test-center/mat136/mat136-review-plan-mock';

export const metadata: Metadata = {
  title: 'MAT136 证据化复习计划 Mock',
  description: '模拟从学习记忆、错题和日历证据生成可执行复习计划的完整对话。',
};

export default function Mat136ReviewPlanChatPage() {
  return <Mat136ReviewPlanMock />;
}
