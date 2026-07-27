import type { Metadata } from 'next';
import { NewUserJourneyWorkspace } from '@/features/qa/test-center/new-user/new-user-journey-workspace';

export const metadata: Metadata = {
  title: '新用户全旅程定性验收',
  description: '从首次到访到真实学习闭环的 Syntara 新用户定性测试工作台。',
};

export default function NewUserQualitativeJourneyPage() {
  return <NewUserJourneyWorkspace />;
}
