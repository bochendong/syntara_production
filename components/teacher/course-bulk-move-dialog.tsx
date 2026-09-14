'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, BookOpenText, Check, Library, Loader2, Search } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { backendJson } from '@/lib/utils/backend-api';
import {
  groupBulkMoveCourses,
  type BulkMovePreview,
  type BulkMoveResult,
} from '@/lib/teacher/course-bulk-move';

export function CourseBulkMoveDialog({
  courseId,
  courseName,
  onMoved,
  previewMode = false,
  selection,
  contentKind,
  triggerLabel = '复制到课程',
  iconOnly = false,
  disabled = false,
}: {
  courseId: string;
  courseName: string;
  onMoved: () => Promise<void>;
  previewMode?: boolean;
  selection?: { notebookIds?: string[]; problemIds?: string[] };
  contentKind?: 'notebooks' | 'problems';
  triggerLabel?: string;
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<BulkMovePreview | null>(null);
  const [targetId, setTargetId] = useState('');
  const [notebooks, setNotebooks] = useState(true);
  const [problems, setProblems] = useState(true);
  const [notebookIds, setNotebookIds] = useState<string[]>([]);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const selectionKey = JSON.stringify(selection ?? null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const submitting = useRef(false);
  const endpoint = `/api/teacher/courses/${encodeURIComponent(courseId)}/bulk-move`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setPreview(null);
    setError('');
    const load = previewMode
      ? Promise.resolve<BulkMovePreview>({
          targets: [
            {
              id: 'preview-2027-winter',
              name: 'Business Fundamentals',
              courseCode: 'BUS200',
              academicYear: 2027,
              academicTerm: 'winter',
            },
            {
              id: 'preview-2026-fall',
              name: 'Introduction to Economics',
              courseCode: 'ECO101',
              academicYear: 2026,
              academicTerm: 'fall',
            },
            {
              id: 'preview-2026-summer',
              name: 'Business Fundamentals',
              courseCode: 'BUS200',
              academicYear: 2026,
              academicTerm: 'summer',
            },
          ].filter((c) => c.id !== courseId),
          notebooks: {
            count: 3,
            version: '',
            items: [
              { id: 'demo-book-1', name: '第一章 · 基础概念' },
              { id: 'demo-book-2', name: '第二章 · 应用' },
              { id: 'demo-book-3', name: '复习笔记' },
            ],
          },
          problems: {
            count: 12,
            version: '',
            chapters: [
              { id: 'demo-chapter-1', name: '第一章 · 基础概念', count: 5 },
              { id: 'demo-chapter-2', name: '第二章 · 应用', count: 7 },
              { id: '__unfiled__', name: '未归档', count: 0 },
            ],
          },
        })
      : backendJson<BulkMovePreview>(endpoint, { signal: controller.signal, cache: 'no-store' });
    void load
      .then((data) => {
        if (controller.signal.aborted) return;
        setPreview(data);
        const scoped = JSON.parse(selectionKey) as typeof selection;
        setNotebookIds(scoped?.notebookIds ?? data.notebooks.items.map((item) => item.id));
        setChapterIds(data.problems.chapters.map((item) => item.id));
        setNotebooks(scoped ? Boolean(scoped.notebookIds) : contentKind !== 'problems');
        setProblems(scoped ? Boolean(scoped.problemIds) : contentKind !== 'notebooks');
        setTargetId((id) => (data.targets.some((course) => course.id === id) ? id : ''));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : '无法加载课程，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, endpoint, courseId, previewMode, revision, selectionKey, contentKind]);

  const target = preview?.targets.find((course) => course.id === targetId);
  const countBooks = notebooks ? notebookIds.length : 0;
  const countProblems = problems
    ? (selection?.problemIds?.length ??
      preview?.problems.chapters
        .filter((item) => chapterIds.includes(item.id))
        .reduce((sum, item) => sum + item.count, 0) ??
      0)
    : 0;
  const hasContent = Boolean(
    countBooks + countProblems ||
    (problems && !selection && chapterIds.some((id) => id !== '__unfiled__')),
  );
  const groups = groupBulkMoveCourses(
    (preview?.targets ?? []).filter((course) =>
      `${course.courseCode ?? ''} ${course.name} ${course.academicYear ?? ''} ${course.academicTerm ?? ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ),
  );

  async function submit() {
    if (submitting.current || !preview || !target || !hasContent) return;
    if (previewMode) {
      toast.info('这是界面预览；真实课程中确认后即可复制。');
      return;
    }
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await backendJson<BulkMoveResult>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetCourseId: targetId,
          operation: 'copy',
          notebookIds,
          ...(selection?.problemIds ? { problemIds: selection.problemIds } : { chapterIds }),
          notebooks,
          problems,
          notebookVersion: preview.notebooks.version,
          problemVersion: preview.problems.version,
        }),
      });
      setOpen(false);
      setPreview(null);
      toast.success(
        `已复制 ${result.notebooks} 本笔记本、${result.problems} 道题至 ${target.courseCode || target.name}`,
      );
      await onMoved().catch(() => toast.info('操作已完成；刷新即可查看最新内容。'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法确认复制结果，请刷新列表查看。');
      // Do not allow a second write with the same preview after an uncertain network outcome.
      setPreview(null);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (submitting.current) return;
        setOpen(value);
        if (value) {
          setPreview(null);
          setTargetId('');
          setQuery('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          onClick={(event) => event.stopPropagation()}
          type="button"
          variant="outline"
          size={iconOnly ? 'icon-sm' : 'sm'}
          disabled={disabled}
          title={triggerLabel}
          aria-label={triggerLabel}
          className={iconOnly ? 'size-8 rounded-lg p-0' : 'h-8 gap-1.5 rounded-lg px-2.5 text-xs'}
        >
          <Copy className="size-3.5" />
          {iconOnly ? null : triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        onClick={(event) => event.stopPropagation()}
        size="large"
        className="gap-0 overflow-hidden p-0"
        showCloseButton={!saving}
      >
        <DialogHeader className="shrink-0 border-b border-slate-200/80 px-6 py-5 pr-16 dark:border-white/10">
          <DialogTitle className="text-xl">复用课程内容</DialogTitle>
          <DialogDescription>
            将「{courseName}」的 AI 笔记本或题库用于另一门课程。
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row">
          <section
            className="flex min-h-56 flex-1 flex-col border-b border-slate-200/80 p-5 md:min-h-0 md:border-r md:border-b-0 dark:border-white/10"
            aria-label="选择目标课程"
          >
            <h3 className="mb-3 text-sm font-semibold">1. 选择目标课程</h3>
            <div className="relative mb-4">
              <Search className="absolute top-3 left-3 size-4 text-slate-400" />
              <Input
                aria-label="搜索目标课程"
                placeholder="搜索课号、课程名或学期"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
                disabled={saving}
              />
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              {loading ? (
                <p role="status" className="flex items-center gap-2 py-8 text-slate-500">
                  <Loader2 className="size-4 animate-spin" />
                  正在加载课程…
                </p>
              ) : null}
              {!loading && preview && !groups.length ? (
                <p className="py-8 text-slate-500">
                  {preview.targets.length ? '没有匹配的课程。' : '暂无其他可管理的课程。'}
                </p>
              ) : null}
              {groups.map((group) => (
                <fieldset key={group.term} disabled={saving}>
                  <legend className="mb-2 text-xs font-semibold tracking-wide text-slate-500">
                    {group.term}
                  </legend>
                  <div className="space-y-2">
                    {group.courses.map((course) => (
                      <label
                        key={course.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition ${targetId === course.id ? 'border-violet-400 bg-violet-50 dark:bg-violet-500/15' : 'border-slate-200 bg-white hover:border-violet-300 dark:border-white/10 dark:bg-white/5'}`}
                      >
                        <input
                          type="radio"
                          name={`bulk-move-target-${courseId}`}
                          value={course.id}
                          checked={targetId === course.id}
                          onChange={() => setTargetId(course.id)}
                          className="size-4 accent-violet-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {course.courseCode || course.name}
                          </span>
                          {course.courseCode && course.courseCode !== course.name ? (
                            <span className="block truncate text-xs text-slate-500">
                              {course.name}
                            </span>
                          ) : null}
                        </span>
                        {targetId === course.id ? (
                          <Check className="size-4 shrink-0 text-violet-600" />
                        ) : null}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </section>
          <section className="flex flex-1 flex-col p-5 md:max-w-[48%]" aria-label="选择复用内容">
            <h3 className="mb-4 text-sm font-semibold">2. 选择复用内容</h3>
            <div className="space-y-3">
              {(
                [
                  {
                    key: 'notebooks',
                    label: 'AI 笔记本',
                    detail: '包含页面、讲解和笔记本图片',
                    icon: BookOpenText,
                    checked: notebooks,
                    set: setNotebooks,
                    count: selection?.notebookIds?.length ?? preview?.notebooks.count,
                    unit: '本',
                  },
                  {
                    key: 'problems',
                    label: '题库',
                    detail: '保留章节、题目、答案与知识点分类',
                    icon: Library,
                    checked: problems,
                    set: setProblems,
                    count: selection?.problemIds?.length ?? preview?.problems.count,
                    unit: '道题',
                  },
                ] as const
              )
                .filter(
                  (item) =>
                    !selection ||
                    (item.key === 'notebooks'
                      ? selection.notebookIds?.length
                      : selection.problemIds?.length),
                )
                .map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) => item.set(event.target.checked)}
                      disabled={
                        saving ||
                        !preview ||
                        Boolean(selection) ||
                        (contentKind !== undefined && contentKind !== item.key)
                      }
                      className="mt-1 size-4 accent-violet-600"
                    />
                    <item.icon className="mt-0.5 size-5 text-violet-500" />
                    <span className="flex-1">
                      <span className="block font-semibold">{item.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {item.detail}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-slate-500">
                      {item.count ?? '—'} {item.unit}
                    </span>
                  </label>
                ))}
            </div>
            {preview && !selection ? (
              <div className="mt-4 space-y-4">
                {notebooks ? (
                  <fieldset disabled={saving} className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">选择笔记本</legend>
                    {preview.notebooks.items.map((item) => (
                      <label key={item.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={notebookIds.includes(item.id)}
                          onChange={(event) =>
                            setNotebookIds((ids) =>
                              event.target.checked
                                ? [...ids, item.id]
                                : ids.filter((id) => id !== item.id),
                            )
                          }
                        />
                        {item.name}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                {problems ? (
                  <fieldset disabled={saving} className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">按章节选择</legend>
                    {preview.problems.chapters.map((item) => (
                      <label key={item.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={chapterIds.includes(item.id)}
                          onChange={(event) =>
                            setChapterIds((ids) =>
                              event.target.checked
                                ? [...ids, item.id]
                                : ids.filter((id) => id !== item.id),
                            )
                          }
                        />
                        <span className="flex-1">{item.name}</span>
                        <span className="text-slate-500">{item.count} 道题</span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
              </div>
            ) : selection ? (
              <p className="mt-4 text-sm text-slate-500">
                仅操作当前选中的 {countBooks ? `${countBooks} 本笔记本` : `${countProblems} 道题`}。
              </p>
            ) : null}
            <div className="mt-5 rounded-2xl bg-violet-50 p-5 text-sm leading-7 dark:bg-violet-500/10">
              <p className="font-semibold">
                {target ? `将复制至 ${target.courseCode || target.name}` : '请在左侧选择一门课程'}
              </p>
              <p>
                已选 {countBooks} 本笔记本 · {countProblems} 道题
              </p>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                原课程内容保留，复制后两门课程各自编辑、互不影响；学生答题记录和学习进度不会复制。
              </p>
              {notebooks !== problems ? (
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                  {notebooks ? '题库留在原课程。' : 'AI 笔记本留在原课程。'}
                </p>
              ) : null}
              {previewMode ? (
                <p className="mt-2 text-violet-600">当前为界面预览，不会复制真实资料。</p>
              ) : null}
            </div>
          </section>
        </div>
        {error ? (
          <div
            role="alert"
            className="flex shrink-0 items-center justify-between gap-3 border-t border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-700"
          >
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevision((value) => value + 1)}
              disabled={loading || saving}
            >
              刷新列表
            </Button>
          </div>
        ) : null}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200/80 px-6 py-4 dark:border-white/10">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            取消
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || loading || !target || !preview || !hasContent}
            className="gap-2 bg-violet-600 text-white hover:bg-violet-700"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
            {saving ? `正在复制…` : `确认复制`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
