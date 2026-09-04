'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, LibraryBig, Loader2, RefreshCw, Search } from 'lucide-react';
import {
  COURSE_SPACE_BODY_SURFACE_CLASS,
  CourseSpaceHeader,
  resolveCourseSpaceHeaderFields,
} from '@/components/course-space/course-space-header';
import { Button } from '@/components/ui/button';
import {
  readLearnCourseListCache,
  upsertLearnCourseListCache,
} from '@/components/learn/learn-course-list-cache';
import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { getLocalStudyMemoryUserId } from '@/lib/learning/study-memory';
import { cn } from '@/lib/utils';
import { BackendApiError } from '@/lib/utils/backend-api';
import { getCourseOrThrow } from '@/lib/utils/course-storage';
import type { CourseRecord } from '@/lib/utils/database';
import { listStagesByCourseOrThrow, type StageListItem } from '@/lib/utils/stage-storage';

type Props = { courseId: string; initialNotebookId?: string | null };
type RequestStatus = 'loading' | 'ready' | 'error';
type CourseStatus = RequestStatus | 'not_found';

function formatNotebookDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '尚未更新';
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function NotebookCover({ notebook }: { notebook: StageListItem }) {
  const kind = (notebook.notebookKind ?? 'image') === 'markdown' ? 'Markdown' : '互动讲义';
  const chapterCount = notebook.sectionCount ?? notebook.sceneCount ?? 0;
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[18px] text-left shadow-[0_18px_36px_rgba(15,23,42,0.14)] transition duration-200 group-hover:-translate-y-1 group-hover:-rotate-[0.5deg] group-hover:shadow-[0_24px_42px_rgba(15,23,42,0.18)]">
      <span className="absolute inset-y-0 left-0 z-20 w-5 bg-[linear-gradient(90deg,#172f51,#315b8d_55%,#213f67)] shadow-[inset_-1px_0_0_rgba(255,255,255,0.2)]" />
      <span className="absolute inset-y-3 left-[6px] z-30 flex flex-col justify-around">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="size-2 rounded-full bg-slate-200 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]"
          />
        ))}
      </span>
      <div
        className="absolute inset-0 py-5 pl-8 pr-4"
        style={{
          background:
            'repeating-linear-gradient(180deg,transparent 0 27px,rgba(148,163,184,.18) 27px 28px),linear-gradient(145deg,#f8fbfd 0%,#edf3f8 52%,#e7edf3 100%)',
        }}
      >
        <div className="flex h-full flex-col">
          <span className="w-fit rounded-md border border-blue-200 bg-white/80 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-blue-700">
            {kind}
          </span>
          <h3 className="mt-5 line-clamp-4 text-base font-bold leading-6 text-slate-900">
            {notebook.name}
          </h3>
          <div className="mt-auto text-xs leading-5 text-slate-500">
            <p>{chapterCount} 个章节</p>
            <p>{formatNotebookDate(notebook.updatedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadErrorNotice({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 break-words text-xs leading-5 opacity-80">{error}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 rounded-xl border-current/20 bg-white/65 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
        onClick={onRetry}
      >
        <RefreshCw className="mr-1.5 size-3.5" />
        重试
      </Button>
    </div>
  );
}

export function CourseResourceLibraryPageClient({ courseId, initialNotebookId }: Props) {
  const [course, setCourse] = useState<CourseRecord | null | undefined>(undefined);
  const [courseStatus, setCourseStatus] = useState<CourseStatus>('loading');
  const [courseError, setCourseError] = useState<string | null>(null);
  const [courseReloadKey, setCourseReloadKey] = useState(0);
  const [notebooks, setNotebooks] = useState<StageListItem[]>([]);
  const [notebooksStatus, setNotebooksStatus] = useState<RequestStatus>('loading');
  const [notebooksError, setNotebooksError] = useState<string | null>(null);
  const [notebooksReloadKey, setNotebooksReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(
    initialNotebookId ?? null,
  );

  const filteredNotebooks = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return notebooks;
    return notebooks.filter((notebook) => {
      const haystack = [notebook.name, notebook.description, ...(notebook.tags ?? [])]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [notebooks, query]);
  const selectedNotebook = notebooks.find((notebook) => notebook.id === selectedNotebookId) ?? null;

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void listStagesByCourseOrThrow(courseId, { signal: controller.signal, timeoutMs: 90_000 })
      .then((loadedNotebooks) => {
        if (!alive) return;
        const sorted = [...loadedNotebooks].sort(
          (left, right) =>
            (left.learningOrder ?? Number.MAX_SAFE_INTEGER) -
              (right.learningOrder ?? Number.MAX_SAFE_INTEGER) ||
            right.updatedAt - left.updatedAt ||
            left.name.localeCompare(right.name, 'zh-CN'),
        );
        setNotebooks(sorted);
        setSelectedNotebookId((current) =>
          current && sorted.some((item) => item.id === current) ? current : (sorted[0]?.id ?? null),
        );
        setNotebooksStatus('ready');
      })
      .catch((error) => {
        if (!alive || controller.signal.aborted) return;
        setNotebooksStatus('error');
        setNotebooksError(error instanceof Error ? error.message : '笔记本读取失败，请重试。');
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [courseId, notebooksReloadKey]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const localUserId = getLocalStudyMemoryUserId();
    const cachedCourse = readLearnCourseListCache(localUserId, { allowStale: true })?.find(
      (candidate) => candidate.id === courseId,
    );
    if (cachedCourse) {
      Promise.resolve().then(() => {
        if (alive) setCourse((current) => current ?? cachedCourse);
      });
    }
    void getCourseOrThrow(courseId, { signal: controller.signal, timeoutMs: 90_000 })
      .then((loadedCourse) => {
        if (!alive) return;
        setCourse(loadedCourse);
        setCourseStatus('ready');
        upsertLearnCourseListCache(localUserId, loadedCourse);
      })
      .catch((error) => {
        if (!alive || controller.signal.aborted) return;
        if (error instanceof BackendApiError && (error.status === 403 || error.status === 404)) {
          setCourse(null);
          setCourseStatus('not_found');
          return;
        }
        setCourseStatus('error');
        setCourseError(error instanceof Error ? error.message : '课程信息读取失败，请重试。');
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [courseId, courseReloadKey]);

  if (course === undefined && courseStatus === 'loading') {
    return (
      <main className="grid min-h-full place-items-center bg-[#f3f6fb] text-sm text-slate-500 dark:bg-[#0e1117] dark:text-slate-300">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在读取资料库…
        </span>
      </main>
    );
  }
  if (course === undefined && courseStatus === 'error') {
    return (
      <main className="min-h-full bg-[#f3f6fb] p-6 dark:bg-[#0e1117]">
        <div className="mx-auto max-w-xl">
          <LoadErrorNotice
            title="课程信息暂时无法读取"
            error={courseError || '请稍后重试。'}
            onRetry={() => {
              setCourse(undefined);
              setCourseStatus('loading');
              setCourseError(null);
              setCourseReloadKey((current) => current + 1);
            }}
          />
        </div>
      </main>
    );
  }
  if (courseStatus === 'not_found' || !course) {
    return (
      <main className="grid min-h-full place-items-center bg-[#f3f6fb] p-6 text-center dark:bg-[#0e1117]">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm dark:border-white/10 dark:bg-white/[0.06]">
          <LibraryBig className="mx-auto size-10 text-slate-400" strokeWidth={1.5} />
          <h1 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">未找到课程</h1>
          <Button asChild className="mt-5 rounded-xl">
            <Link href="/my-courses">返回我的课程</Link>
          </Button>
        </div>
      </main>
    );
  }

  const courseAvatarUrl = resolveCourseAvatarDisplayUrl(course.id, course.avatarUrl);
  return (
    <main className="min-h-full bg-[#f3f6fb] text-slate-950 dark:bg-[#0e1117] dark:text-white">
      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-4 px-3 py-4 md:px-5 lg:px-6">
        <CourseSpaceHeader
          courseId={courseId}
          {...resolveCourseSpaceHeaderFields(course)}
          courseAvatarUrl={courseAvatarUrl}
          role="student"
          active="resources"
        />
        {courseError ? (
          <LoadErrorNotice
            title="课程信息刷新失败，当前继续显示缓存内容"
            error={courseError}
            onRetry={() => {
              setCourseStatus('loading');
              setCourseError(null);
              setCourseReloadKey((current) => current + 1);
            }}
          />
        ) : null}

        <section
          className={cn(
            COURSE_SPACE_BODY_SURFACE_CLASS,
            'overflow-hidden rounded-[24px] bg-white/90 dark:bg-white/[0.055]',
          )}
        >
          <div className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-5 sm:flex-row sm:items-end sm:justify-between dark:border-white/10">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-200">
                Notebook library
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                资料库
              </h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                这里只收纳课程笔记本。学习状态、班级对比和课程概览已归入 Dashboard。
              </p>
            </div>
            <label className="relative block w-full sm:max-w-sm">
              <span className="sr-only">筛选笔记本</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                strokeWidth={1.8}
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="按名称或标签筛选笔记本"
                className="h-10 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:focus:ring-blue-400/10"
              />
            </label>
          </div>

          {notebooksStatus === 'loading' && notebooks.length === 0 ? (
            <div className="grid min-h-[28rem] place-items-center text-sm text-slate-500">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                正在加载笔记本…
              </span>
            </div>
          ) : notebooksStatus === 'error' && notebooks.length === 0 ? (
            <div className="p-5">
              <LoadErrorNotice
                title="笔记本暂时无法读取"
                error={notebooksError || '请稍后重试。'}
                onRetry={() => {
                  setNotebooksStatus('loading');
                  setNotebooksError(null);
                  setNotebooksReloadKey((current) => current + 1);
                }}
              />
            </div>
          ) : filteredNotebooks.length === 0 ? (
            <div className="grid min-h-[28rem] place-items-center px-6 text-center text-sm text-slate-500">
              <div className="max-w-sm">
                <BookOpen className="mx-auto size-9 text-slate-300" strokeWidth={1.5} />
                <p className="mt-3 font-semibold text-slate-700 dark:text-slate-200">
                  {notebooks.length ? '没有匹配的笔记本' : '这门课还没有笔记本'}
                </p>
                <p className="mt-1 text-xs leading-5">
                  {notebooks.length ? '换个名称或标签再试。' : '创建或加入笔记本后会显示在这里。'}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.38fr)]">
              <div className="grid content-start grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-6 gap-y-8 rounded-[20px] bg-slate-50/75 p-5 dark:bg-black/10">
                {filteredNotebooks.map((notebook) => (
                  <button
                    key={notebook.id}
                    type="button"
                    aria-label={`查看 ${notebook.name}`}
                    aria-pressed={selectedNotebook?.id === notebook.id}
                    onClick={() => setSelectedNotebookId(notebook.id)}
                    className={cn(
                      'group mx-auto block w-full max-w-[205px] rounded-[18px] text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-4',
                      selectedNotebook?.id === notebook.id &&
                        'ring-2 ring-blue-500 ring-offset-4 ring-offset-slate-50 dark:ring-offset-slate-950',
                    )}
                  >
                    <NotebookCover notebook={notebook} />
                  </button>
                ))}
              </div>

              <aside className="flex min-h-[27rem] flex-col rounded-[20px] border border-slate-200/80 bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
                {selectedNotebook ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700 dark:bg-blue-400/15 dark:text-blue-100">
                        {(selectedNotebook.notebookKind ?? 'image') === 'markdown'
                          ? 'Markdown'
                          : '互动讲义'}
                      </span>
                      <span className="text-slate-400">
                        {selectedNotebook.sectionCount ?? selectedNotebook.sceneCount ?? 0} 个章节
                      </span>
                    </div>
                    <h2 className="mt-4 text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
                      {selectedNotebook.name}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
                      {selectedNotebook.description?.trim() || '打开笔记本查看完整课程内容。'}
                    </p>
                    {selectedNotebook.tags?.length ? (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {selectedNotebook.tags.slice(0, 8).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <dl className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-black/10">
                      <div>
                        <dt className="text-xs text-slate-400">内容形式</dt>
                        <dd className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
                          {(selectedNotebook.notebookKind ?? 'image') === 'markdown'
                            ? 'Markdown'
                            : '图片笔记本'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">最近更新</dt>
                        <dd className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
                          {formatNotebookDate(selectedNotebook.updatedAt)}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-auto pt-6">
                      <Button asChild className="w-full rounded-xl">
                        <Link href={`/classroom/${encodeURIComponent(selectedNotebook.id)}`}>
                          <BookOpen className="mr-1.5 size-4" />
                          打开笔记本
                        </Link>
                      </Button>
                    </div>
                  </>
                ) : null}
              </aside>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
