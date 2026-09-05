'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  FileText,
  LibraryBig,
  Loader2,
  Network,
  RefreshCw,
  Search,
} from 'lucide-react';
import { NotebookMindMapPreview } from '@/components/courses/notebook-mind-map-preview';
import { COURSE_SPACE_BODY_SURFACE_CLASS } from '@/components/course-space/course-space-header';
import { StudentCoursePageFrame } from '@/components/course-space/student-course-page-frame';
import { Button } from '@/components/ui/button';
import {
  readLearnCourseListCache,
  upsertLearnCourseListCache,
} from '@/components/learn/learn-course-list-cache';
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

const NOTEBOOK_COVER_THEMES = [
  'bg-[#e8f3ef] text-[#24574c] dark:bg-teal-950 dark:text-teal-100',
  'bg-[#edf0fa] text-[#3e5084] dark:bg-indigo-950 dark:text-indigo-100',
  'bg-[#f7efdf] text-[#806137] dark:bg-amber-950 dark:text-amber-100',
  'bg-[#f1ebf6] text-[#72518a] dark:bg-purple-950 dark:text-purple-100',
  'bg-[#f7eae7] text-[#945d50] dark:bg-rose-950 dark:text-rose-100',
] as const;

function NotebookCover({
  notebook,
  index,
  selected,
}: {
  notebook: StageListItem;
  index: number;
  selected: boolean;
}) {
  const isMarkdown = (notebook.notebookKind ?? 'image') === 'markdown';
  const kind = isMarkdown ? 'Markdown' : '互动讲义';
  const Icon = isMarkdown ? FileText : BookOpen;
  const chapterCount = notebook.sectionCount ?? notebook.sceneCount ?? 0;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[18px]">
      <div
        className={cn(
          'relative flex min-h-[236px] flex-1 flex-col border-l-[5px] border-black/[0.08] px-5 pb-4 pt-5 sm:min-h-[252px]',
          NOTEBOOK_COVER_THEMES[index % NOTEBOOK_COVER_THEMES.length],
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold">
            <Icon className="size-3.5" strokeWidth={1.8} />
            {kind}
          </span>
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full transition',
              selected ? 'bg-white text-teal-700 shadow-sm' : 'opacity-0',
            )}
          >
            <Check className="size-3" strokeWidth={2.5} />
          </span>
        </div>
        <h3
          title={notebook.name}
          className="mb-5 mt-6 line-clamp-4 break-words text-[17px] font-semibold leading-7 tracking-tight"
        >
          {notebook.name}
        </h3>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-current/15 pt-3">
          <span className="text-xs font-medium">{chapterCount} 个章节</span>
          <span aria-hidden="true" className="font-mono text-lg font-light opacity-45">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>
      </div>
      <div className="flex min-h-14 items-center justify-between gap-2 bg-white px-4 py-3 dark:bg-slate-900">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {formatNotebookDate(notebook.updatedAt)}
        </span>
        {notebook.hasMindMap ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-teal-700 dark:text-teal-300">
            <Network className="size-3" />
            导图
          </span>
        ) : (
          <ArrowUpRight
            aria-hidden="true"
            className="size-3.5 text-slate-400 transition group-hover:text-teal-600"
          />
        )}
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
  const selectedNotebook =
    filteredNotebooks.find((notebook) => notebook.id === selectedNotebookId) ??
    filteredNotebooks[0] ??
    null;

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
      <StudentCoursePageFrame courseId={courseId} active="resources">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在读取资料库…
        </span>
      </StudentCoursePageFrame>
    );
  }
  if (course === undefined && courseStatus === 'error') {
    return (
      <StudentCoursePageFrame courseId={courseId} active="resources">
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
      </StudentCoursePageFrame>
    );
  }
  if (courseStatus === 'not_found' || !course) {
    return (
      <StudentCoursePageFrame courseId={courseId} active="resources">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm dark:border-white/10 dark:bg-white/[0.06]">
          <LibraryBig className="mx-auto size-10 text-slate-400" strokeWidth={1.5} />
          <h1 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">未找到课程</h1>
          <Button asChild className="mt-5 rounded-xl">
            <Link href="/my-courses">返回我的课程</Link>
          </Button>
        </div>
      </StudentCoursePageFrame>
    );
  }

  return (
    <StudentCoursePageFrame courseId={courseId} course={course} active="resources">
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
            <p className="text-[11px] font-semibold tracking-[0.1em] text-teal-700 dark:text-teal-300">
              课程笔记本
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              资料库
            </h1>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              把课程知识整理成册，随时翻阅与回顾。
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
          <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.62fr)]">
            <div className="min-w-0 rounded-[20px] bg-slate-50/80 p-4 sm:p-5 dark:bg-black/10">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <LibraryBig className="size-4 text-slate-400" />
                  全部笔记本
                  <span className="rounded-md bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-400 dark:bg-white/5">
                    {filteredNotebooks.length}
                  </span>
                </h2>
                <span className="text-xs text-slate-400">点击封面预览</span>
              </div>
              <div className="grid auto-cols-[minmax(180px,72%)] grid-flow-col items-stretch gap-4 overflow-x-auto p-1 pb-3 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] sm:overflow-visible sm:p-0 xl:gap-5">
                {filteredNotebooks.map((notebook) => (
                  <button
                    key={notebook.id}
                    type="button"
                    aria-label={`查看 ${notebook.name}`}
                    aria-pressed={selectedNotebook?.id === notebook.id}
                    onClick={() => setSelectedNotebookId(notebook.id)}
                    className={cn(
                      'group block w-full rounded-[18px] border text-left shadow-[0_3px_12px_rgba(15,23,42,0.035)] outline-none transition duration-200 motion-safe:hover:-translate-y-1 hover:shadow-[0_8px_20px_rgba(15,23,42,0.07)] focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-4',
                      selectedNotebook?.id === notebook.id
                        ? 'border-teal-600 ring-2 ring-teal-600/80 ring-offset-2 ring-offset-slate-50 dark:ring-teal-400 dark:ring-offset-slate-950'
                        : 'border-slate-200/70 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/25',
                    )}
                  >
                    <NotebookCover
                      notebook={notebook}
                      index={notebooks.indexOf(notebook)}
                      selected={selectedNotebook?.id === notebook.id}
                    />
                  </button>
                ))}
              </div>
            </div>

            <aside
              aria-label="笔记本详情"
              className="flex min-w-0 flex-col self-start rounded-[20px] border border-slate-200/80 bg-white p-5 sm:p-6 dark:border-white/10 dark:bg-white/[0.04]"
            >
              {selectedNotebook ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                    <span className="rounded-md bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                      {(selectedNotebook.notebookKind ?? 'image') === 'markdown'
                        ? 'Markdown'
                        : '互动讲义'}
                    </span>
                    <span className="text-slate-400">
                      {selectedNotebook.sectionCount ?? selectedNotebook.sceneCount ?? 0} 个章节
                    </span>
                  </div>
                  <h2 className="mt-4 break-words text-xl font-semibold leading-8 tracking-tight text-slate-950 dark:text-white">
                    {selectedNotebook.name}
                  </h2>
                  {selectedNotebook.description?.trim() ? (
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-500 dark:text-slate-300">
                      {selectedNotebook.description.trim()}
                    </p>
                  ) : null}
                  {selectedNotebook.hasMindMap ? (
                    <NotebookMindMapPreview
                      key={`${courseId}:${selectedNotebook.id}:${selectedNotebook.updatedAt}`}
                      courseId={courseId}
                      notebookId={selectedNotebook.id}
                      title={selectedNotebook.name}
                    />
                  ) : (
                    <div className="mt-6 rounded-2xl bg-slate-50 p-5 dark:bg-white/5">
                      <BookOpen
                        className="size-6 text-teal-600 dark:text-teal-300"
                        strokeWidth={1.5}
                      />
                      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                        从这里开始阅读
                      </p>
                      <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
                        共 {selectedNotebook.sectionCount ?? selectedNotebook.sceneCount ?? 0}{' '}
                        个章节，打开笔记本查看完整内容。
                      </p>
                    </div>
                  )}
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
                  <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm dark:border-white/10">
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
                    <Button asChild className="h-11 w-full rounded-xl">
                      <Link href={`/classroom/${encodeURIComponent(selectedNotebook.id)}`}>
                        <BookOpen className="mr-1.5 size-4" />
                        打开笔记本
                        <ArrowUpRight className="ml-auto size-4" />
                      </Link>
                    </Button>
                  </div>
                </>
              ) : null}
            </aside>
          </div>
        )}
      </section>
    </StudentCoursePageFrame>
  );
}
