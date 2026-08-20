import { CheckCircle2 } from 'lucide-react';

import { SyntaraMark } from '@/components/brand/syntara-mark';

export default async function SpeedupSignedOutPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const role = (await searchParams).role === 'teacher' ? '教师端' : '学生端';
  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_top,#eef6ff_0%,#f7f9fc_42%,#eef2f7_100%)] px-5 py-10">
      <section className="w-full max-w-xl rounded-[32px] border border-white/80 bg-white/95 p-7 shadow-[0_28px_80px_rgba(15,23,42,0.14)] sm:p-10">
        <div className="flex items-center gap-3">
          <SyntaraMark className="size-12 rounded-2xl shadow-sm" />
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-400">
              SPEEDUP AI COURSES
            </p>
            <p className="mt-1 text-sm font-medium text-slate-600">Syntara AI 课程系统</p>
          </div>
        </div>

        <div className="mt-8 inline-flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-7" strokeWidth={2} />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">已退出{role}</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          当前 AI 课程会话已安全退出。请回到 Speedup 系统重新登录，再从课程页面进入 AI 课程。
        </p>
        <div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
          此页面无需继续操作，您可以直接关闭当前页面。
        </div>
      </section>
    </main>
  );
}
