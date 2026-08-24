'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { BookOpenText, Library, MessageCircleMore, MessagesSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CourseSpaceRole = 'teacher' | 'student';
export type CourseSpaceSection = 'resources' | 'chat' | 'problem-bank' | 'forum';

type CourseSpaceNavigationProps = {
  courseId: string;
  role: CourseSpaceRole;
  active: CourseSpaceSection;
  problemCount?: number;
  forumCount?: number;
  className?: string;
};

function navigationItems({
  courseId,
  role,
  problemCount,
  forumCount,
}: Omit<CourseSpaceNavigationProps, 'active' | 'className'>) {
  const encodedCourseId = encodeURIComponent(courseId);
  return [
    ...(role === 'teacher'
      ? [
          {
            key: 'resources' as const,
            label: '资料库',
            href: `/teacher/courses/${encodedCourseId}`,
            Icon: BookOpenText,
          },
        ]
      : []),
    {
      key: 'chat' as const,
      label: '课程聊天',
      href: `/learn?courseId=${encodedCourseId}${role === 'teacher' ? '&from=teacher' : ''}`,
      Icon: MessageCircleMore,
    },
    ...(typeof problemCount === 'number' && problemCount > 0
      ? [
          {
            key: 'problem-bank' as const,
            label: '题库',
            href: `/course/${encodedCourseId}/problem-bank`,
            Icon: Library,
          },
        ]
      : []),
    {
      key: 'forum' as const,
      label: '课程论坛',
      href: `/course/${encodedCourseId}/forum`,
      Icon: MessagesSquare,
      count: forumCount,
    },
  ];
}

export function CourseSpaceNavigation({
  courseId,
  role,
  active,
  problemCount,
  forumCount,
  className,
}: CourseSpaceNavigationProps) {
  const items = navigationItems({ courseId, role, problemCount, forumCount });

  return (
    <nav
      aria-label="课程导航"
      className={cn(
        'flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200/80 bg-slate-100/75 p-1 dark:border-white/10 dark:bg-white/[0.045]',
        className,
      )}
    >
      {items.map(({ key, label, href, Icon, count }) => {
        const selected = active === key;
        return (
          <Link
            key={key}
            href={href}
            aria-current={selected ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500/30 sm:text-sm',
              selected
                ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/10 dark:text-white dark:ring-white/10'
                : 'text-slate-500 hover:bg-white/70 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white',
            )}
          >
            <Icon
              className={cn(
                'size-4 shrink-0',
                selected ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400',
              )}
              strokeWidth={1.9}
            />
            <span>{label}</span>
            {key === 'forum' && typeof count === 'number' && count > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold leading-5 text-white">
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function CourseSpaceHeader({
  courseId,
  courseTitle,
  courseMeta,
  role,
  active,
  problemCount,
  forumCount,
  actions,
  className,
}: CourseSpaceNavigationProps & {
  courseTitle: string;
  courseMeta?: string;
  actions?: ReactNode;
}) {
  return (
    <header
      data-course-space-header
      className={cn(
        'shrink-0 border-b border-slate-200/80 bg-white/95 px-4 py-3 text-slate-950 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 dark:text-white sm:px-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-300/15">
            <BookOpenText className="size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-[-0.025em] sm:text-xl">
              {courseTitle}
            </h1>
            {courseMeta ? (
              <p className="mt-0.5 truncate text-xs font-medium text-slate-400">{courseMeta}</p>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          <CourseSpaceNavigation
            courseId={courseId}
            role={role}
            active={active}
            problemCount={problemCount}
            forumCount={forumCount}
            className="max-w-full"
          />
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}
