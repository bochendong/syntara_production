'use client';

import type { ReactNode } from 'react';
import { useCourseSpaceShell } from './course-space-shell-context';
import {
  COURSE_SPACE_PAGE_FILL_CLASS,
  COURSE_SPACE_PAGE_INNER_CLASS,
  COURSE_SPACE_PAGE_MIN_HEIGHT_CLASS,
  COURSE_SPACE_PAGE_OUTER_CLASS,
  COURSE_SPACE_PAGE_PADDING_CLASS,
} from '@/lib/course-space/course-space-layout';
import { cn } from '@/lib/utils';

export function CourseSpacePageFrame({
  children,
  className,
  variant = 'scroll',
}: {
  children: ReactNode;
  className?: string;
  /** `fill` keeps the frame height for full-viewport shells such as course chat. */
  variant?: 'scroll' | 'fill';
}) {
  const hasSharedShell = useCourseSpaceShell();
  return (
    <div
      className={cn(
        COURSE_SPACE_PAGE_OUTER_CLASS,
        COURSE_SPACE_PAGE_PADDING_CLASS,
        hasSharedShell && 'flex flex-col',
        variant === 'fill' && 'h-full',
      )}
    >
      <div
        className={cn(
          COURSE_SPACE_PAGE_INNER_CLASS,
          variant === 'fill'
            ? COURSE_SPACE_PAGE_FILL_CLASS
            : hasSharedShell
              ? 'min-h-0 flex-1'
              : COURSE_SPACE_PAGE_MIN_HEIGHT_CLASS,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
