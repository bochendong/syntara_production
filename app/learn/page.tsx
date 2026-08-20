import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { BookOpenCheck } from 'lucide-react';
import { LearnHomePageClient } from '@/components/learn/learn-home-page-client';
import { LearnPageShellSkeleton } from '@/components/learn/learn-page-shell-skeleton';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { requireServerSession } from '@/lib/server/auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const LearnPageClient = dynamic(() =>
  import('@/components/learn/learn-page-client').then((mod) => mod.LearnPageClient),
);

type LearnPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function currentUserCannotAccessCourse(courseId: string): Promise<boolean> {
  const session = await requireServerSession();
  const userId = session?.user?.id?.trim();
  const prisma = getOptionalPrisma();
  if (!userId || !prisma) return false;
  try {
    return (await findCourseAccessRole(prisma, userId, courseId)) === null;
  } catch {
    // Let the client use its cached shell and normal API error handling when
    // the optional database is temporarily unavailable.
    return false;
  }
}

function CourseAccessClosedCard() {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-6 text-center dark:bg-slate-950">
      <div className="max-w-sm">
        <BookOpenCheck className="mx-auto size-8 text-slate-400" strokeWidth={1.6} />
        <h1 className="mt-4 text-lg font-semibold text-slate-950 dark:text-slate-50">
          课程权限已关闭
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          机构已关闭这门课程的 AI 访问权限。如有疑问，请联系机构管理员。
        </p>
        <Link
          href="/learn"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-950 dark:hover:bg-slate-200"
        >
          返回全部课程
        </Link>
      </div>
    </div>
  );
}

export default async function LearnPage({ searchParams }: LearnPageProps) {
  const params = await searchParams;
  const previewLearnHome = process.env.NODE_ENV !== 'production' && params.previewLearnHome === '1';
  const hasCourseId = typeof params.courseId === 'string' && params.courseId.trim().length > 0;
  const hasSessionId = typeof params.session === 'string' && params.session.trim().length > 0;
  const debugNoCourses = params.debugNoCourses === '1';

  if (!hasCourseId && !hasSessionId && !debugNoCourses) {
    return <LearnHomePageClient preview={previewLearnHome} />;
  }

  if (hasCourseId && (await currentUserCannotAccessCourse((params.courseId as string).trim()))) {
    return <CourseAccessClosedCard />;
  }

  return (
    <Suspense fallback={<LearnPageShellSkeleton />}>
      <LearnPageClient />
    </Suspense>
  );
}
