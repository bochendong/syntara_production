import type { ReactNode } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

type CourseSpaceImageCardProps = {
  imageUrl: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  imageAlt?: string;
  priority?: boolean;
};

/** Shared course artwork card used by both teacher and student resource libraries. */
export function CourseSpaceImageCard({
  imageUrl,
  children,
  className,
  contentClassName,
  imageAlt = '',
  priority = false,
}: CourseSpaceImageCardProps) {
  return (
    <section
      className={cn(
        'relative min-h-[12.5rem] overflow-hidden rounded-[24px] border border-white/75 bg-slate-100 shadow-[0_18px_54px_rgba(15,23,42,0.11)] ring-1 ring-slate-900/[0.035] dark:border-white/10 dark:bg-slate-950 dark:shadow-[0_22px_60px_rgba(0,0,0,0.32)] sm:min-h-[14rem]',
        className,
      )}
    >
      <Image
        src={imageUrl}
        alt={imageAlt}
        fill
        priority={priority}
        sizes="(min-width: 1536px) 1472px, 100vw"
        className="object-cover brightness-[1.08] saturate-[1.06]"
        aria-hidden={imageAlt ? undefined : true}
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(110deg,rgba(15,23,42,0.36)_0%,rgba(15,23,42,0.16)_56%,rgba(15,23,42,0.05)_100%)] dark:bg-[linear-gradient(110deg,rgba(8,13,24,0.78)_0%,rgba(8,13,24,0.54)_56%,rgba(8,13,24,0.26)_100%)]"
        aria-hidden
      />
      <div
        className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-950/48 via-slate-950/12 to-transparent dark:from-slate-950/78 dark:via-slate-950/22"
        aria-hidden
      />
      <div
        className={cn(
          'relative z-10 flex min-h-[12.5rem] flex-col justify-end p-5 sm:min-h-[14rem] sm:p-6',
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
