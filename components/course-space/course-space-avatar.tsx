'use client';

import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { cn } from '@/lib/utils';

export function CourseSpaceAvatar({
  courseId,
  avatarUrl,
  className,
}: {
  courseId: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const src = resolveCourseAvatarDisplayUrl(courseId, avatarUrl);

  return (
    <img
      src={src}
      alt=""
      className={cn(
        'size-8 shrink-0 rounded-[9px] object-cover ring-1 ring-black/5 dark:ring-white/10',
        className,
      )}
    />
  );
}
