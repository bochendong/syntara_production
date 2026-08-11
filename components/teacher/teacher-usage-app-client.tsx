'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { BarChart3 } from 'lucide-react';
import { TeacherAppShell } from '@/components/teacher/teacher-app-shell';
import { TokenUsageAccountPanel } from '@/components/user-profile/token-usage-card';
import { isLocalDemoUserId } from '@/lib/auth/local-demo';

export function TeacherUsageAppClient() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const hydrated = sessionStatus !== 'loading';
  const isLoggedIn = sessionStatus === 'authenticated';
  const role =
    session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN' ? 'TEACHER' : 'STUDENT';
  const teacherId = session?.user?.id || '';
  const localDemo = isLocalDemoUserId(teacherId);

  useEffect(() => {
    if (!hydrated) return;
    if (!isLoggedIn || role !== 'TEACHER') router.replace('/teacher/login');
  }, [hydrated, isLoggedIn, role, router]);

  if (!hydrated || !isLoggedIn || role !== 'TEACHER' || !teacherId) return null;

  return (
    <TeacherAppShell
      testId="teacher-usage-app"
      title="用量统计"
      eyebrow="AI USAGE"
      description="通过每日聚合桶查看 Token 趋势；明细只读取最近 10 条生成记录。"
      Icon={BarChart3}
      accentClassName="bg-gradient-to-br from-violet-400 via-violet-600 to-violet-900"
    >
      <div className="p-4 sm:p-6">
        <TokenUsageAccountPanel variant="tab" localDemo={localDemo} />
      </div>
    </TeacherAppShell>
  );
}
