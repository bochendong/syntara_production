'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
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
import { useCourseSpaceHeaderSlots, useCourseSpaceShell } from './course-space-shell-context';

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
        'flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-slate-100/65 p-1 dark:border-white/10 dark:bg-white/[0.045]',
        className,
      )}
    >
      {items.map(({ key, label, href, Icon, disabled }) => {
        const selected = active === key;
        const itemClassName = cn(
          'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-400/40',
          selected
            ? 'bg-white text-sky-800 shadow-[0_1px_4px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 dark:bg-white/10 dark:text-sky-100 dark:ring-white/10'
            : 'text-slate-500 hover:bg-white/70 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white',
          disabled && 'pointer-events-none opacity-45',
        );
        const content = (
          <>
            <Icon
              className={cn(
                'size-3.5 shrink-0',
                selected ? 'text-sky-600 dark:text-sky-300' : 'text-slate-400',
              )}
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
  beforeTitleActions?: ReactNode;
  trailingActions?: ReactNode;
  actionTargets?: {
    actions: Ref<HTMLDivElement>;
    beforeTitle: Ref<HTMLDivElement>;
    trailingActions: Ref<HTMLDivElement>;
  };
  surface?: boolean;
};

/** Supplies page metadata and portals each section's controls into the persistent header. */
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
  beforeTitleActions,
  trailingActions,
  surface = true,
  className,
}: CourseSpaceHeaderProps) {
  const hasSharedShell = useCourseSpaceShell();
  const headerSlots = useCourseSpaceHeaderSlots(courseId, active);
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
    return (
      <>
        {headerSlots?.actions && actions ? createPortal(actions, headerSlots.actions) : null}
        {headerSlots?.beforeTitle && beforeTitleActions
          ? createPortal(beforeTitleActions, headerSlots.beforeTitle)
          : null}
        {headerSlots?.trailingActions && trailingActions
          ? createPortal(trailingActions, headerSlots.trailingActions)
          : null}
      </>
    );
  }

  return (
    <CourseSpaceHeaderContent
      courseId={courseId}
      courseTitle={displayedHeader?.courseTitle ?? courseTitle}
      role={displayedRole}
      active={active}
      previewMode={previewMode}
      actions={actions}
      beforeTitleActions={beforeTitleActions}
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
  beforeTitleActions,
  trailingActions,
  actionTargets,
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
        'shrink-0 bg-gradient-to-b from-white to-slate-50/75 px-3 py-2 text-slate-950 backdrop-blur-xl dark:from-slate-950 dark:to-slate-900/90 dark:text-white sm:px-4',
        surface
          ? COURSE_SPACE_HEADER_SURFACE_CLASS
          : 'border-b border-slate-200/80 dark:border-white/10',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-col gap-2',
          trailingActions || actionTargets
            ? 'xl:flex-row xl:items-center xl:justify-between'
            : 'md:flex-row md:items-center md:justify-between',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:flex-nowrap">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-500 outline-none transition hover:border-slate-200 hover:bg-white hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-sky-400/40 dark:text-slate-400 dark:hover:border-white/10 dark:hover:bg-white/[0.07] dark:hover:text-white"
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
            className="max-w-[calc(100%-2.5rem)]"
          />
          {actions || actionTargets ? (
            <div
              ref={actionTargets?.actions}
              data-course-header-actions
              className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden xl:flex-nowrap"
            >
              {actions}
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            'flex min-w-0 items-center justify-end gap-2.5 md:ml-auto md:flex-1',
            (trailingActions || actionTargets) && 'flex-wrap xl:flex-nowrap',
          )}
        >
          {beforeTitleActions || actionTargets ? (
            <div
              ref={actionTargets?.beforeTitle}
              data-course-header-before-title
              className="flex shrink-0 items-center gap-2 empty:hidden"
            >
              {beforeTitleActions}
            </div>
          ) : null}
          <h1
            className="truncate rounded-lg border border-slate-200/70 bg-white/80 px-2.5 py-1.5 text-sm font-semibold tracking-[-0.02em] shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-white/10 dark:bg-white/5 sm:text-[15px]"
            title={courseTitle}
          >
            {courseTitle}
          </h1>
          <Link
            href={allCoursesHref}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 outline-none transition hover:bg-white hover:text-sky-700 focus-visible:ring-2 focus-visible:ring-sky-400/40 dark:hover:bg-white/[0.07] dark:hover:text-sky-200"
            aria-label="所有课程"
            title="所有课程"
          >
            <Home className="size-4 shrink-0" strokeWidth={1.9} />
          </Link>
          {trailingActions || actionTargets ? (
            <div
              ref={actionTargets?.trailingActions}
              data-course-header-trailing-actions
              className="flex shrink-0 items-center gap-2 empty:hidden"
            >
              {trailingActions}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
