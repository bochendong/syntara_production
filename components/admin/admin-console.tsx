'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookOpen,
  Bot,
  Coins,
  Gauge,
  Image as ImageIcon,
  Volume2,
  Search,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AdminLLMSection } from '@/components/admin/admin-llm-section';
import { AdminCreditsSection } from '@/components/admin/admin-credits-section';
import { AdminSiteProvidersSection } from '@/components/admin/admin-site-providers-section';
import { AdminCoursesSection } from '@/components/admin/admin-courses-section';
import { AdminTeachersSection } from '@/components/admin/admin-teachers-section';
import { AdminStudentsSection } from '@/components/admin/admin-students-section';
import { AdminUsageLimitsSection } from '@/components/admin/admin-usage-limits-section';

const SECTIONS = [
  { id: 'llm', label: 'AI 模型与用量', icon: Bot },
  { id: 'students', label: '学生管理', icon: Users },
  { id: 'teachers', label: '老师管理', icon: Users },
  { id: 'usage-limits', label: '云端限额', icon: Gauge },
  { id: 'credits', label: '积分管理', icon: Coins },
  { id: 'courses', label: '课程管理', icon: BookOpen },
  { id: 'image', label: '图像生成', icon: ImageIcon },
  { id: 'tts', label: '语音合成', icon: Volume2 },
  { id: 'web-search', label: '网络搜索', icon: Search },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function AdminConsole() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);

  const rawSection = searchParams.get('section');
  const section: SectionId = SECTIONS.some((s) => s.id === rawSection)
    ? (rawSection as SectionId)
    : 'llm';

  const setSection = (id: SectionId) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('section', id);
    router.replace(`/admin?${next.toString()}`);
  };

  const title = useMemo(() => {
    const hit = SECTIONS.find((s) => s.id === section);
    return hit?.label ?? '语言模型';
  }, [section]);

  return (
    <div className="flex min-h-full w-full flex-col apple-mesh-bg px-4 py-6 md:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            管理员控制台
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            全站 AI 与运营配置
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          <RefreshCw className="mr-1 h-4 w-4" />
          刷新
        </Button>
      </div>

      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        <div className="w-56 shrink-0 bg-muted/30 p-3 space-y-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left',
                  active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b p-5">
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {section === 'llm' ? <AdminLLMSection key={refreshKey} /> : null}
            {section === 'teachers' ? <AdminTeachersSection key={refreshKey} /> : null}
            {section === 'usage-limits' ? <AdminUsageLimitsSection key={refreshKey} /> : null}
            {section === 'students' ? (
              <AdminStudentsSection key={refreshKey} refreshKey={refreshKey} />
            ) : null}
            {section === 'credits' ? <AdminCreditsSection key={refreshKey} /> : null}
            {section === 'courses' ? <AdminCoursesSection key={refreshKey} /> : null}
            {section === 'image' ? (
              <AdminSiteProvidersSection key={refreshKey} kind="image" />
            ) : null}
            {section === 'tts' ? <AdminSiteProvidersSection key={refreshKey} kind="tts" /> : null}
            {section === 'web-search' ? (
              <AdminSiteProvidersSection key={refreshKey} kind="web-search" />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
