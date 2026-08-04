'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { StudentPortalHeader } from '@/components/student/student-portal-header';
import { Button } from '@/components/ui/button';

export function StudentAppShell({
  title,
  description,
  eyebrow,
  Icon,
  accentClassName,
  testId,
  children,
}: {
  title: string;
  description: string;
  eyebrow: string;
  Icon: LucideIcon;
  accentClassName: string;
  testId: string;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <div
      data-testid={testId}
      className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.09),transparent_28%),linear-gradient(180deg,#f8fafc,#eef2f7)] p-3 text-slate-950 dark:bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.12),transparent_30%),linear-gradient(180deg,#07111f,#020617)] dark:text-white sm:p-4"
    >
      <div className="mx-auto flex min-h-[calc(100dvh-24px)] w-full max-w-7xl flex-col gap-4 sm:min-h-[calc(100dvh-32px)]">
        <StudentPortalHeader compact />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.055]">
          <header className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-5 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-start gap-4">
              <span
                className={`grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg ${accentClassName}`}
              >
                <Icon className="size-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {eyebrow}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-300">
                  {description}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-fit shrink-0 rounded-xl"
              onClick={() => router.push('/learn')}
            >
              <ArrowLeft className="mr-1.5 size-4" />
              返回学生桌面
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
