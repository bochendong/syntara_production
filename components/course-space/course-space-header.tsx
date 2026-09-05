'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  Home,
  LayoutDashboard,
  Library,
  MessageCircleMore,
  MessagesSquare,
  Users,
} from 'lucide-react';
import { COURSE_SPACE_HEADER_SURFACE_CLASS } from '@/lib/course-space/format-course-space-header';
import {
  isCourseSpaceHeaderPlaceholder,
  readCourseSpaceHeaderCache,
  subscribeCourseSpaceHeaderCache,
  writeCourseSpaceHeaderCache,
} from '@/lib/course-space/course-space-header-cache';
import { cn } from '@/lib/utils';
import type { CourseSpaceRole, CourseSpaceSection } from '@/lib/course-space/course-space-route';
import { useCourseSpaceShell } from './course-space-shell-context';

export type { CourseSpaceRole, CourseSpaceSection } from '@/lib/course-space/course-space-route';

export {
  COURSE_SPACE_BODY_SURFACE_CLASS,
  COURSE_SPACE_HEADER_SURFACE_CLASS,
  formatCourseSpaceMeta,
  formatCourseSpaceTitle,
  resolveCourseSpaceHeaderFields,
} from '@/lib/course-space/format-course-space-header';

type CourseSpaceNavItem = {
  key: CourseSpaceSection;
  label: string;
  href: string;
  Icon: typeof BookOpenText;
  disabled?: boolean;
};

export function courseSpaceAllCoursesHref(role: CourseSpaceRole, previewMode?: boolean): string {
  if (role === 'teacher') {
    return previewMode ? '/teacher?mock=1' : '/teacher';
  }
  return previewMode ? '/learn?uiPreview=1' : '/learn';
}

type CourseSpaceNavigationProps = {
  courseId: string;
  role: CourseSpaceRole;
  active: CourseSpaceSection;
  previewMode?: boolean;
  className?: string;
};

function navigationItems({
  courseId,
  role,
  previewMode,
}: Omit<CourseSpaceNavigationProps, 'active' | 'className'>): CourseSpaceNavItem[] {
  const encodedCourseId = encodeURIComponent(courseId);
  const problemBankHref = `/course/${encodedCourseId}/problem-bank${
    previewMode ? `?mock=1${role === 'teacher' ? '&asTeacher=1' : ''}` : ''
  }`;
  const resourceLibraryHref =
    role === 'teacher'
      ? `/teacher/courses/${encodedCourseId}${previewMode ? '?mock=1' : ''}`
      : `/course/${encodedCourseId}/resources${previewMode ? '?mock=1' : ''}`;

  return [
    ...(role === 'student'
      ? [
          {
            key: 'dashboard' as const,
            label: 'Dashboard',
            href: `/course/${encodedCourseId}${previewMode ? '?mock=1' : ''}`,
            Icon: LayoutDashboard,
          },
        ]
      : []),
    {
      key: 'resources' as const,
      label: '资料库',
      href: resourceLibraryHref,
      Icon: BookOpenText,
    },
    {
      key: 'chat' as const,
      label: '聊天',
      href: `/learn?courseId=${encodedCourseId}${role === 'teacher' ? '&from=teacher' : ''}${previewMode ? '&uiPreview=1' : ''}`,
      Icon: MessageCircleMore,
    },
    {
      key: 'problem-bank' as const,
      label: '题库',
      href: problemBankHref,
      Icon: Library,
    },
    {
      key: 'forum' as const,
      label: '论坛',
      href: `/course/${encodedCourseId}/forum${previewMode ? `?mock=1${role === 'teacher' ? '&asTeacher=1' : ''}` : ''}`,
      Icon: MessagesSquare,
    },
    ...(role === 'teacher'
      ? [
          {
            key: 'students' as const,
            label: '学生管理',
            href: `/teacher/courses/${encodedCourseId}/students${previewMode ? '?mock=1' : ''}`,
            Icon: Users,
          },
        ]
      : []),
  ];
}

export function CourseSpaceNavigation({
  courseId,
  role,
  active,
  previewMode,
  className,
}: CourseSpaceNavigationProps) {
  const items = navigationItems({ courseId, role, previewMode });

  return (
    <nav
      aria-label="课程导航"
      className={cn(
        'flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200/80 bg-slate-100/75 p-0.5 dark:border-white/10 dark:bg-white/[0.045]',
        className,
      )}
    >
      {items.map(({ key, label, href, Icon, disabled }) => {
        const selected = active === key;
        const itemClassName = cn(
          'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-primary/30',
          selected
            ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/10 dark:text-white dark:ring-white/10'
            : 'text-slate-500 hover:bg-white/70 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white',
          disabled && 'pointer-events-none opacity-45',
        );
        const content = (
          <>
            <Icon
              className={cn('size-3.5 shrink-0', selected ? 'text-primary' : 'text-slate-400')}
              strokeWidth={1.9}
            />
            <span>{label}</span>
          </>
        );

        if (disabled) {
          return (
            <span
              key={key}
              aria-disabled="true"
              className={itemClassName}
              title="本地预览模式下不可用"
            >
              {content}
            </span>
          );
        }

        return (
          <Link
            key={key}
            href={href}
            scroll={false}
            aria-current={selected ? 'page' : undefined}
            className={itemClassName}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

type CourseSpaceHeaderProps = CourseSpaceNavigationProps & {
  courseTitle: string;
  courseMeta?: string;
  courseAvatarUrl?: string | null;
  problemCount?: number;
  forumCount?: number;
  actions?: ReactNode;
  trailingActions?: ReactNode;
  surface?: boolean;
};

/** Supplies page metadata to the persistent header and keeps page actions in the content area. */
export function CourseSpaceHeader({
  courseId,
  courseTitle,
  courseMeta,
  courseAvatarUrl,
  role,
  active,
  problemCount,
  forumCount,
  previewMode,
  actions,
  trailingActions,
  surface = true,
  className,
}: CourseSpaceHeaderProps) {
  const hasSharedShell = useCourseSpaceShell();
  const placeholder = isCourseSpaceHeaderPlaceholder(courseTitle);
  const subscribeToCachedHeader = useCallback(
    (onStoreChange: () => void) => subscribeCourseSpaceHeaderCache(courseId, onStoreChange),
    [courseId],
  );
  const readCachedHeader = useCallback(() => readCourseSpaceHeaderCache(courseId), [courseId]);
  const cachedHeader = useSyncExternalStore(subscribeToCachedHeader, readCachedHeader, () => null);

  useEffect(() => {
    if (placeholder) return;
    writeCourseSpaceHeaderCache({
      courseId,
      courseTitle,
      courseMeta,
      courseAvatarUrl,
      role,
      problemCount,
      forumCount,
    });
  }, [
    courseAvatarUrl,
    courseId,
    courseMeta,
    courseTitle,
    forumCount,
    placeholder,
    problemCount,
    role,
  ]);

  const displayedHeader = placeholder && cachedHeader ? cachedHeader : null;
  const displayedRole = displayedHeader?.role ?? role;

  if (hasSharedShell) {
    return actions || trailingActions ? (
      <div
        data-course-space-actions
        className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2"
      >
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
        {trailingActions ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">{trailingActions}</div>
        ) : null}
      </div>
    ) : null;
  }

  return (
    <CourseSpaceHeaderContent
      courseId={courseId}
      courseTitle={displayedHeader?.courseTitle ?? courseTitle}
      role={displayedRole}
      active={active}
      previewMode={previewMode}
      actions={actions}
      trailingActions={trailingActions}
      surface={surface}
      className={className}
    />
  );
}

export function CourseSpaceHeaderContent({
  courseId,
  courseTitle,
  role,
  active,
  previewMode,
  actions,
  trailingActions,
  surface = true,
  className,
}: CourseSpaceHeaderProps) {
  const router = useRouter();
  const allCoursesHref = courseSpaceAllCoursesHref(role, previewMode);
  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(allCoursesHref);
  }, [allCoursesHref, router]);

  return (
    <header
      data-course-space-header
      className={cn(
        'shrink-0 bg-white/95 px-3 py-1.5 text-slate-950 backdrop-blur-xl dark:bg-slate-950/95 dark:text-white sm:px-4',
        surface
          ? COURSE_SPACE_HEADER_SURFACE_CLASS
          : 'border-b border-slate-200/80 dark:border-white/10',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-col gap-1.5',
          trailingActions
            ? 'xl:flex-row xl:items-center xl:justify-between'
            : 'md:flex-row md:items-center md:justify-between',
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-500 outline-none transition hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-primary/30 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white"
            aria-label="返回上一页"
            title="返回"
          >
            <ArrowLeft className="size-4 shrink-0" strokeWidth={1.9} />
          </button>
          <CourseSpaceNavigation
            courseId={courseId}
            role={role}
            active={active}
            previewMode={previewMode}
            className="max-w-full"
          />
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>

        <div
          className={cn(
            'flex min-w-0 items-center justify-end gap-1.5 md:ml-auto md:flex-1',
            trailingActions && 'flex-wrap xl:flex-nowrap',
          )}
        >
          <h1
            className="truncate text-sm font-bold tracking-[-0.02em] sm:text-[15px]"
            title={courseTitle}
          >
            {courseTitle}
          </h1>
          <Link
            href={allCoursesHref}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-500 outline-none transition hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-primary/30 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white"
            aria-label="所有课程"
            title="所有课程"
          >
            <Home className="size-4 shrink-0" strokeWidth={1.9} />
          </Link>
          {trailingActions ? (
            <div className="flex shrink-0 items-center gap-2">{trailingActions}</div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
