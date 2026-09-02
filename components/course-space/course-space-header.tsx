'use client';

import Link from 'next/link';
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { BookOpenText, Home, Library, MessageCircleMore, MessagesSquare } from 'lucide-react';
import { COURSE_SPACE_HEADER_SURFACE_CLASS } from '@/lib/course-space/format-course-space-header';
import {
  isCourseSpaceHeaderPlaceholder,
  readCourseSpaceHeaderCache,
  subscribeCourseSpaceHeaderCache,
  writeCourseSpaceHeaderCache,
} from '@/lib/course-space/course-space-header-cache';
import { CourseSpaceAvatar } from '@/components/course-space/course-space-avatar';
import { cn } from '@/lib/utils';

export {
  COURSE_SPACE_BODY_SURFACE_CLASS,
  COURSE_SPACE_HEADER_SURFACE_CLASS,
  formatCourseSpaceMeta,
  formatCourseSpaceTitle,
  resolveCourseSpaceHeaderFields,
} from '@/lib/course-space/format-course-space-header';

export type CourseSpaceRole = 'teacher' | 'student';
export type CourseSpaceSection = 'resources' | 'chat' | 'problem-bank' | 'forum' | 'students';

type CourseSpaceNavItem = {
  key: CourseSpaceSection;
  label: string;
  href: string;
  Icon: typeof BookOpenText;
  count?: number;
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
  problemCount?: number;
  forumCount?: number;
  previewMode?: boolean;
  className?: string;
};

function navigationItems({
  courseId,
  role,
  problemCount,
  forumCount,
  previewMode,
}: Omit<CourseSpaceNavigationProps, 'active' | 'className'>): CourseSpaceNavItem[] {
  const encodedCourseId = encodeURIComponent(courseId);
  const problemBankHref = `/course/${encodedCourseId}/problem-bank${
    previewMode ? `?mock=1${role === 'teacher' ? '&asTeacher=1' : ''}` : ''
  }`;

  return [
    ...(role === 'teacher'
      ? [
          {
            key: 'resources' as const,
            label: '资料库',
            href: `/teacher/courses/${encodedCourseId}${previewMode ? '?mock=1' : ''}`,
            Icon: BookOpenText,
          },
        ]
      : []),
    {
      key: 'chat' as const,
      label: '课程聊天',
      href: `/learn?courseId=${encodedCourseId}${role === 'teacher' ? '&from=teacher' : ''}${previewMode ? '&uiPreview=1' : ''}`,
      Icon: MessageCircleMore,
    },
    {
      key: 'problem-bank' as const,
      label: '题库',
      href: problemBankHref,
      Icon: Library,
      count: problemCount,
    },
    {
      key: 'forum' as const,
      label: '课程论坛',
      href: `/course/${encodedCourseId}/forum${previewMode ? `?mock=1${role === 'teacher' ? '&asTeacher=1' : ''}` : ''}`,
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
  previewMode,
  className,
}: CourseSpaceNavigationProps) {
  const items = navigationItems({ courseId, role, problemCount, forumCount, previewMode });

  return (
    <nav
      aria-label="课程导航"
      className={cn(
        'flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200/80 bg-slate-100/75 p-0.5 dark:border-white/10 dark:bg-white/[0.045]',
        className,
      )}
    >
      {items.map(({ key, label, href, Icon, count, disabled }) => {
        const selected = active === key;
        const itemClassName = cn(
          'inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500/30',
          selected
            ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/10 dark:text-white dark:ring-white/10'
            : 'text-slate-500 hover:bg-white/70 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white',
          disabled && 'pointer-events-none opacity-45',
        );
        const content = (
          <>
            <Icon
              className={cn(
                'size-3.5 shrink-0',
                selected ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400',
              )}
              strokeWidth={1.9}
            />
            <span>{label}</span>
            {key === 'forum' && typeof count === 'number' && count > 0 ? (
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-4 text-white">
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
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
  surface = true,
  className,
}: CourseSpaceNavigationProps & {
  courseTitle: string;
  courseMeta?: string;
  courseAvatarUrl?: string | null;
  actions?: ReactNode;
  /** Rounded card chrome shared across teacher course-space pages. */
  surface?: boolean;
}) {
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
      <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Link
            href={courseSpaceAllCoursesHref(role, previewMode)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-500 outline-none transition hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white"
            aria-label="所有课程"
            title="所有课程"
          >
            <Home className="size-4 shrink-0" strokeWidth={1.9} />
          </Link>
          <CourseSpaceAvatar
            courseId={courseId}
            avatarUrl={displayedHeader?.courseAvatarUrl ?? courseAvatarUrl}
          />
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate text-sm font-bold tracking-[-0.02em] sm:text-[15px]">
              {displayedHeader?.courseTitle ?? courseTitle}
            </h1>
            {(displayedHeader?.courseMeta ?? courseMeta) ? (
              <p className="hidden truncate text-[10px] font-medium text-slate-400 md:block">
                {displayedHeader?.courseMeta ?? courseMeta}
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            'flex w-full shrink-0 flex-wrap items-center justify-end sm:ml-auto sm:w-auto',
            actions ? 'gap-3 lg:gap-4' : 'gap-1.5',
          )}
        >
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          <CourseSpaceNavigation
            courseId={courseId}
            role={displayedRole}
            active={active}
            problemCount={problemCount ?? displayedHeader?.problemCount}
            forumCount={forumCount ?? displayedHeader?.forumCount}
            previewMode={previewMode}
            className="max-w-full"
          />
        </div>
      </div>
    </header>
  );
}
