import Link from 'next/link';
import { BookOpenCheck } from 'lucide-react';

export function CourseAccessClosedCard({
  returnHref,
  returnLabel,
}: {
  returnHref: string;
  returnLabel: string;
}) {
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
          href={returnHref}
          className="mt-5 inline-flex h-9 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-950 dark:hover:bg-slate-200"
        >
          {returnLabel}
        </Link>
      </div>
    </div>
  );
}
