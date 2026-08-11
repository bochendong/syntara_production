'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookOpen,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  MessageCircle,
  MessagesSquare,
  Network,
  X,
} from 'lucide-react';
import { StudentAppShell } from '@/components/student/student-app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { backendJson } from '@/lib/utils/backend-api';

type StudentCoursePayload = {
  previewedByAdmin: boolean;
  student: { id: string; name: string | null; email: string | null } | null;
  course: {
    id: string;
    name: string;
    description: string;
    code: string;
    academicYear: number | null;
    term: 'winter' | 'summer' | 'fall' | null;
    avatarUrl: string | null;
    teacherName: string;
    updatedAt: string;
  };
  progressLimit: {
    notebookAccessLimit: number | null;
    unlockedCount: number;
    totalCount: number;
  };
  notebooks: Array<{
    id: string;
    title: string;
    summary: string;
    kind: 'image' | 'markdown';
    tags: string[];
    order: number;
    unlocked: boolean;
    contentCount: number;
    hasMindMap: boolean;
    updatedAt: string;
  }>;
};

const TERM_LABEL = { winter: 'Winter', summer: 'Summer', fall: 'Fall' } as const;

export function StudentCoursePageClient({ courseId }: { courseId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPreview = searchParams.get('preview') === '1';
  const [payload, setPayload] = useState<StudentCoursePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unresolvedForumCount, setUnresolvedForumCount] = useState(0);
  const [mindMapNotebook, setMindMapNotebook] = useState<
    StudentCoursePayload['notebooks'][number] | null
  >(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const next = await backendJson<StudentCoursePayload>(
          `/api/student/courses/${encodeURIComponent(courseId)}`,
        );
        setPayload(next);
        setError('');
      } catch (loadError) {
        if (!silent) setError(loadError instanceof Error ? loadError.message : '课程加载失败');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [courseId],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15_000);
    const refresh = () => void load(true);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void backendJson<{ unresolvedCount: number }>(
      `/api/course-forum/${encodeURIComponent(courseId)}/summary`,
      { timeoutMs: 12_000 },
    )
      .then((result) => {
        if (!cancelled) setUnresolvedForumCount(Math.max(0, result.unresolvedCount || 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (loading && !payload) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 text-sm text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在读取课程笔记本…
        </span>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center text-sm text-rose-600">
        <div>
          <p className="font-semibold">{error || '课程不存在或没有访问权限'}</p>
          <button
            type="button"
            className="mt-4 underline"
            onClick={() => router.push(requestedPreview ? '/student?preview=1' : '/learn')}
          >
            返回学生桌面
          </button>
        </div>
      </div>
    );
  }

  const previewMode = payload.previewedByAdmin || requestedPreview;
  const homeHref = previewMode ? '/student?preview=1' : '/learn';
  const chatHref = `/learn?courseId=${encodeURIComponent(courseId)}${previewMode ? '&asStudent=1' : ''}`;
  const forumHref = `/course/${encodeURIComponent(courseId)}/forum`;
  const term = payload.course.term ? TERM_LABEL[payload.course.term] : null;

  return (
    <StudentAppShell
      testId="student-course-app"
      title={payload.course.code}
      eyebrow={[payload.course.academicYear, term, 'STUDENT COURSE'].filter(Boolean).join(' · ')}
      description={payload.course.description || `课程教师：${payload.course.teacherName}`}
      Icon={BookOpen}
      accentClassName="bg-gradient-to-br from-sky-400 via-indigo-600 to-slate-950"
      homeHref={homeHref}
      previewMode={previewMode}
    >
      <div className="space-y-5 p-4 sm:p-6">
        {previewMode ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            管理员正在预览 {payload.student?.name || payload.student?.email || '该学生'}{' '}
            的真实学生页面；课程、进度限制和日历写入都会使用该学生账号。
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => router.push(chatHref)}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-sm"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
              <MessageCircle className="size-5" />
            </span>
            <span>
              <strong className="block text-sm">课程聊天</strong>
              <small className="text-slate-500">只依据已开放笔记本回答</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => router.push(forumHref)}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-sm"
          >
            <span className="relative grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
              <MessagesSquare className="size-5" />
              <span
                className={`absolute -top-2 -right-2 grid min-w-5 place-items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white ring-2 ring-white ${unresolvedForumCount > 0 ? 'bg-rose-500' : 'bg-slate-400'}`}
              >
                {unresolvedForumCount > 99 ? '99+' : unresolvedForumCount}
              </span>
            </span>
            <span>
              <strong className="block text-sm">课程论坛</strong>
              <small className="text-slate-500">{unresolvedForumCount} 个问题未解决</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => router.push('/calendar')}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:shadow-sm"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <CalendarDays className="size-5" />
            </span>
            <span>
              <strong className="block text-sm">学习日历</strong>
              <small className="text-slate-500">读取和管理个人安排</small>
            </span>
          </button>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-700">
              <BrainCircuit className="size-5" />
            </span>
            <span>
              <strong className="block text-sm">学习进度</strong>
              <small className="text-slate-500">
                已开放 {payload.progressLimit.unlockedCount}/{payload.progressLimit.totalCount} 本
              </small>
            </span>
          </div>
        </div>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-semibold">AI 笔记本</h2>
              <p className="mt-1 text-xs text-slate-500">
                这里只展示老师整理好的 AI 笔记本和思维导图，不提供源文件与题库。
              </p>
            </div>
            <Badge variant="outline">自动同步</Badge>
          </div>
          <div className="divide-y divide-slate-200">
            {payload.notebooks.length ? (
              payload.notebooks.map((notebook) => (
                <article
                  key={notebook.id}
                  className={`grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center ${notebook.unlocked ? '' : 'bg-slate-50/80'}`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`grid size-11 shrink-0 place-items-center rounded-2xl ${notebook.unlocked ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}
                    >
                      {notebook.unlocked ? (
                        <BookOpen className="size-5" />
                      ) : (
                        <LockKeyhole className="size-5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold">
                          {notebook.order.toString().padStart(2, '0')} · {notebook.title}
                        </h3>
                        <Badge variant="outline">AI 笔记本</Badge>
                        {notebook.hasMindMap ? (
                          <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                            <CheckCircle2 className="mr-1 size-3" />
                            思维导图
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                        {notebook.unlocked
                          ? notebook.summary || `${notebook.contentCount} 个内容单元`
                          : '尚未达到老师设置的课程进度，内容暂未开放。'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {notebook.unlocked ? (
                      <Button
                        variant="outline"
                        onClick={() => router.push(`/classroom/${encodeURIComponent(notebook.id)}`)}
                      >
                        <BookOpen className="mr-2 size-4" />
                        查看笔记本
                      </Button>
                    ) : (
                      <Button variant="outline" disabled>
                        <LockKeyhole className="mr-2 size-4" />
                        进度未开放
                      </Button>
                    )}
                    {notebook.hasMindMap ? (
                      <Button variant="outline" onClick={() => setMindMapNotebook(notebook)}>
                        <Network className="mr-2 size-4" />
                        查看思维导图
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="grid min-h-52 place-items-center text-center text-sm text-slate-500">
                老师还没有发布 AI 笔记本。
              </div>
            )}
          </div>
        </section>
      </div>

      {mindMapNotebook ? (
        <div
          className="fixed inset-0 z-[1700] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${mindMapNotebook.title} 思维导图`}
        >
          <div className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <p className="font-semibold">{mindMapNotebook.title}</p>
                <p className="text-xs text-slate-500">AI 思维导图</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setMindMapNotebook(null)}>
                <X className="size-5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
              <Image
                src={`/api/student/courses/${encodeURIComponent(courseId)}/notebooks/${encodeURIComponent(mindMapNotebook.id)}/mind-map`}
                alt={`${mindMapNotebook.title} 思维导图`}
                width={1800}
                height={1200}
                unoptimized
                className="mx-auto h-auto max-w-full rounded-2xl bg-white shadow-sm"
              />
            </div>
          </div>
        </div>
      ) : null}
    </StudentAppShell>
  );
}
