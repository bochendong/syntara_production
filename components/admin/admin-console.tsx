'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BookOpen, BarChart3, Bot, Gauge, RefreshCw, Users } from 'lucide-react';
import { AiActivityLight } from '@/components/generation/ai-activity-light';
import { COURSE_SPACE_HEADER_SURFACE_CLASS } from '@/lib/course-space/format-course-space-header';
import styles from './admin-workspace.module.css';
import { cn } from '@/lib/utils';
import { AdminAiSection } from '@/components/admin/admin-ai-section';
import { AdminLLMSection } from '@/components/admin/admin-llm-section';
import { AdminCoursesSection } from '@/components/admin/admin-courses-section';
import { AdminStudentsSection } from '@/components/admin/admin-students-section';
import { AdminUsageLimitsSection } from '@/components/admin/admin-usage-limits-section';

import { AdminFailuresSection } from '@/components/admin/admin-failures-section';

const SECTIONS = [
  { id: 'failures', label: '失败记录', icon: BarChart3 },
  { id: 'students', label: '学生管理', icon: Users },
  { id: 'courses', label: '课程管理', icon: BookOpen },
  { id: 'usage', label: '用量明细', icon: BarChart3 },
  { id: 'ai', label: 'AI设置', icon: Bot },
  { id: 'usage-limits', label: '云端限额', icon: Gauge },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function AdminConsole({ basePath = '/admin' }: { basePath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);

  const rawSection = searchParams.get('section');
  const section: SectionId =
    rawSection && SECTIONS.some((item) => item.id === rawSection)
      ? (rawSection as SectionId)
      : 'ai';
  const activeSection = SECTIONS.find((item) => item.id === section);

  useEffect(() => {
    if (!rawSection || SECTIONS.some((item) => item.id === rawSection)) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('section', 'ai');
    router.replace(`${basePath}?${next.toString()}`);
  }, [basePath, rawSection, router, searchParams]);

  const setSection = (id: SectionId) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('section', id);
    router.replace(`${basePath}?${next.toString()}`);
  };

  return (
    <div className={cn(styles.workspace, 'flex h-full min-h-0 flex-col overflow-hidden')}>
      <div className="shrink-0 px-4 pt-4 sm:px-6 lg:px-8">
        <header
          className={cn(
            'relative isolate shrink-0 bg-gradient-to-b from-white to-slate-50/75 px-3 py-2 text-slate-950 backdrop-blur-xl dark:from-slate-950 dark:to-slate-900/90 dark:text-white sm:px-4',
            COURSE_SPACE_HEADER_SURFACE_CLASS,
          )}
        >
          <AiActivityLight />
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href="/"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-500 outline-none transition hover:border-slate-200 hover:bg-white hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-sky-400/40 dark:text-slate-400 dark:hover:border-white/10 dark:hover:bg-white/[0.07] dark:hover:text-white"
                aria-label="返回主页"
                title="返回主页"
              >
                <ArrowLeft className="size-4 shrink-0" strokeWidth={1.9} />
              </Link>
              <nav
                aria-label="管理菜单"
                className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-slate-100/65 p-1 dark:border-white/10 dark:bg-white/[0.045]"
              >
                {SECTIONS.map((item) => {
                  const Icon = item.icon;
                  const selected = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => setSection(item.id)}
                      className={cn(
                        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-400/40',
                        selected
                          ? 'bg-white text-sky-800 shadow-[0_1px_4px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 dark:bg-white/10 dark:text-sky-100 dark:ring-white/10'
                          : 'text-slate-500 hover:bg-white/70 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-3.5 shrink-0',
                          selected ? 'text-sky-600 dark:text-sky-300' : 'text-slate-400',
                        )}
                        strokeWidth={1.9}
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-2.5 lg:ml-auto">
              <h1 className="min-w-0 truncate rounded-lg border border-slate-200/70 bg-white/80 px-2.5 py-1.5 text-xs font-medium tracking-[-0.02em] shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-white/10 dark:bg-white/5">
                {activeSection?.label ?? '管理员控制台'}
              </h1>
              <button
                type="button"
                aria-label="刷新当前页面"
                title="刷新"
                onClick={() => setRefreshKey((key) => key + 1)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 outline-none transition hover:bg-white hover:text-sky-700 focus-visible:ring-2 focus-visible:ring-sky-400/40 dark:hover:bg-white/[0.07] dark:hover:text-sky-200"
              >
                <RefreshCw className="size-4 shrink-0" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </header>
      </div>
      <main
        className={cn(
          styles.section,
          'mx-auto min-h-0 w-full max-w-[1480px] flex-1 overflow-y-auto px-5 py-7 lg:px-8',
        )}
      >
        {section === 'failures' ? <AdminFailuresSection key={refreshKey} /> : null}
        {section === 'ai' ? <AdminAiSection key={refreshKey} /> : null}
        {section === 'usage' ? <AdminLLMSection key={refreshKey} /> : null}
        {section === 'usage-limits' ? <AdminUsageLimitsSection key={refreshKey} /> : null}
        {section === 'students' ? (
          <AdminStudentsSection key={refreshKey} refreshKey={refreshKey} />
        ) : null}
        {section === 'courses' ? <AdminCoursesSection key={refreshKey} /> : null}
      </main>
    </div>
  );
}
