'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { StudentAppShell } from '@/components/student/student-app-shell';
import { TokenUsageAccountPanel } from '@/components/user-profile/token-usage-card';
import { usePersistHydrated } from '@/lib/hooks/use-persist-hydrated';
import { useAuthStore } from '@/lib/store/auth';

export function StudentUsageAppClient() {
  const router = useRouter();
  const hydrated = usePersistHydrated(useAuthStore);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);
  const role = useAuthStore((state) => state.role);
  const studentId = useAuthStore((state) => state.userId);

  useEffect(() => {
    if (!hydrated) return;
    if (!isLoggedIn || role !== 'STUDENT') {
      router.replace('/speedup/signed-out?role=student');
    }
  }, [hydrated, isLoggedIn, role, router]);

  if (!hydrated || !isLoggedIn || role !== 'STUDENT' || !studentId) return null;

  return (
    <StudentAppShell
      testId="student-usage-app"
      title="用量统计"
      eyebrow="MY AI USAGE"
      description="查看你在已授权课程中的 AI 使用趋势；数据只属于当前学生账号。"
      Icon={BarChart3}
      accentClassName="bg-gradient-to-br from-violet-400 via-violet-600 to-violet-900"
    >
      <div className="p-4 sm:p-6">
        <TokenUsageAccountPanel variant="tab" />
      </div>
    </StudentAppShell>
  );
}
