import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { CourseAccessClosedCard } from '@/components/course-access-closed-card';
import { LearnHomePageClient } from '@/components/learn/learn-home-page-client';
import { LearnPageShellSkeleton } from '@/components/learn/learn-page-shell-skeleton';
import { currentCoursePageAccess } from '@/lib/server/current-course-page-access';

const LearnPageClient = dynamic(() =>
  import('@/components/learn/learn-page-client').then((mod) => mod.LearnPageClient),
);

type LearnPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LearnPage({ searchParams }: LearnPageProps) {
  const params = await searchParams;
  const uiPreview = params.uiPreview === '1';
  const previewLearnHome =
    uiPreview || (process.env.NODE_ENV !== 'production' && params.previewLearnHome === '1');
  const hasCourseId = typeof params.courseId === 'string' && params.courseId.trim().length > 0;
  const hasSessionId = typeof params.session === 'string' && params.session.trim().length > 0;
  const debugNoCourses = params.debugNoCourses === '1';

  if (!hasCourseId && !hasSessionId && !debugNoCourses) {
    return <LearnHomePageClient preview={previewLearnHome} />;
  }

  if (
    hasCourseId &&
    !uiPreview &&
    (await currentCoursePageAccess((params.courseId as string).trim())) === null
  ) {
    return <CourseAccessClosedCard returnHref="/learn" returnLabel="返回全部课程" />;
  }

  return (
    <Suspense fallback={<LearnPageShellSkeleton />}>
      <LearnPageClient />
    </Suspense>
  );
}
