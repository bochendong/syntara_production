'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertCircle,
  ClipboardCheck,
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { CourseSpaceHeader } from '@/components/course-space/course-space-header';
import { CourseSpacePageFrame } from '@/components/course-space/course-space-page-frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { aiFetch } from '@/lib/ai-progress/ai-fetch';
import { useReportAiActivity } from '@/lib/ai-progress/use-ai-activity';
import { toast } from '@/lib/notifications/client-toast';

const ASSIGNMENT_ACCEPT = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg';

type Role = 'teacher' | 'student';
type Feedback = {
  summary: string;
  issues: Array<{ line: number; severity: 'attention' | 'important'; message: string }>;
  checkedAt: string;
};
type Assignment = {
  id: string;
  title: string;
  instructions: string;
  published: boolean;
  exemplarFileName?: string | null;
  version: number;
  submissionCount?: number;
};
type Submission = {
  id: string;
  fileName: string;
  reviewStatus: string;
  reviewError: string | null;
  feedbackJson: Feedback | null;
  sourceVersion: number;
  createdAt: string;
  student?: { name: string | null; email: string | null };
};
type ListResponse = {
  role: 'owner' | 'enrolled';
  course: { name: string; courseCode: string | null };
  assignments: Assignment[];
};

async function responseData<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function FeedbackPanel({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return (
    <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-400/20 dark:bg-sky-400/10">
      <p className="text-sm font-medium text-sky-950 dark:text-sky-100">{feedback.summary}</p>
      {feedback.issues.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {feedback.issues.map((issue, index) => (
            <li
              key={`${issue.line}-${index}`}
              className="rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <span className="mr-2 font-semibold text-sky-700 dark:text-sky-300">
                第 {issue.line} 行
              </span>
              {issue.message}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="mt-3 text-xs text-sky-800/75 dark:text-sky-200/75">
        这是辅助检查，不给标准答案，也不代替老师的最终判断。
      </p>
    </div>
  );
}

export function CourseAssignmentsClient({
  courseId,
  role,
  previewMode = false,
}: {
  courseId: string;
  role: Role;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const { status } = useSession();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [published, setPublished] = useState(false);
  const [exemplarFile, setExemplarFile] = useState<File | null>(null);
  const [removeExemplar, setRemoveExemplar] = useState(false);
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  useReportAiActivity(saving || checking || Boolean(retryingId));

  const base = `/api/courses/${encodeURIComponent(courseId)}/assignments`;
  const selected = data?.assignments.find((item) => item.id === selectedId) ?? null;

  const load = useCallback(
    async (preferredId?: string | null) => {
      if (previewMode) {
        setData({
          role: role === 'teacher' ? 'owner' : 'enrolled',
          course: { name: '课程预览', courseCode: 'DEMO' },
          assignments: [
            {
              id: 'preview-assignment',
              title: '第一周作业',
              instructions: '检查推理是否完整，并说明关键假设。提交文件需清晰可读。',
              published: true,
              version: 1,
              submissionCount: 0,
            },
          ],
        });
        setSelectedId(preferredId === null ? null : 'preview-assignment');
        setLoading(false);
        return;
      }
      try {
        const result = await responseData<ListResponse>(await fetch(base, { cache: 'no-store' }));
        if (result.role !== (role === 'teacher' ? 'owner' : 'enrolled'))
          throw new Error('当前账号无权访问这个作业页面。');
        setData(result);
        setSelectedId((previous) => {
          const choice = preferredId === undefined ? previous : preferredId;
          return choice && result.assignments.some((item) => item.id === choice)
            ? choice
            : (result.assignments[0]?.id ?? null);
        });
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '作业列表暂时无法读取。');
      } finally {
        setLoading(false);
      }
    },
    [base, previewMode, role],
  );

  useEffect(() => {
    if (previewMode) {
      void load();
      return;
    }
    if (status === 'unauthenticated') {
      router.replace(role === 'teacher' ? '/teacher/login' : '/login');
      return;
    }
    if (status === 'authenticated') void load();
  }, [load, previewMode, role, router, status]);

  useEffect(() => {
    if (role !== 'teacher') return;
    setTitle(selected?.title ?? '');
    setInstructions(selected?.instructions ?? '');
    setPublished(selected?.published ?? false);
    setExemplarFile(null);
    setRemoveExemplar(false);
  }, [role, selectedId, selected?.title, selected?.instructions, selected?.published]);

  const loadSubmissions = useCallback(
    async (assignmentId: string) => {
      if (previewMode) {
        setSubmissions([]);
        return;
      }
      try {
        const result = await responseData<{ submissions: Submission[] }>(
          await fetch(`${base}/${encodeURIComponent(assignmentId)}/submissions`, {
            cache: 'no-store',
          }),
        );
        setSubmissions(result.submissions);
      } catch (cause) {
        setSubmissions([]);
        toast.error(cause instanceof Error ? cause.message : '提交记录读取失败。');
      }
    },
    [base, previewMode],
  );

  useEffect(() => {
    if (selectedId) void loadSubmissions(selectedId);
    else setSubmissions([]);
  }, [selectedId, loadSubmissions]);

  async function saveAssignment() {
    if (previewMode) return toast.error('预览模式不能保存。');
    if (!title.trim() || !instructions.trim()) {
      toast.error('请填写作业标题和检查要点。');
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.set('title', title.trim());
      form.set('instructions', instructions.trim());
      form.set('published', String(published));
      if (exemplarFile) form.set('file', exemplarFile);
      if (removeExemplar) form.set('removeExemplar', 'true');
      const result = await responseData<{ id?: string }>(
        await fetch(selected ? `${base}/${encodeURIComponent(selected.id)}` : base, {
          method: selected ? 'PATCH' : 'POST',
          body: form,
        }),
      );
      await load(result.id ?? selected?.id ?? null);
      toast.success(selected ? '作业已更新。' : '作业已创建。');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  }

  async function submitAssignment() {
    if (previewMode) return toast.error('预览模式不能提交。');
    if (!selected || !studentFile) return;
    setChecking(true);
    try {
      const form = new FormData();
      form.set('file', studentFile);
      const result = await responseData<{ reviewStatus: string; error?: string }>(
        await aiFetch(`${base}/${encodeURIComponent(selected.id)}/submissions`, {
          method: 'POST',
          body: form,
        }),
      );
      setStudentFile(null);
      await loadSubmissions(selected.id);
      if (result.reviewStatus === 'complete') toast.success('作业已保存，问题检查完成。');
      else toast.error(result.error || '作业已保存，检查暂时失败，可稍后重试。');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '上传失败。');
    } finally {
      setChecking(false);
    }
  }

  async function retryReview(submissionId: string) {
    if (previewMode) return toast.error('预览模式不能检查。');
    if (!selected) return;
    setRetryingId(submissionId);
    try {
      await responseData(
        await aiFetch(
          `${base}/${encodeURIComponent(selected.id)}/submissions/${encodeURIComponent(submissionId)}`,
          { method: 'POST' },
        ),
      );
      await loadSubmissions(selected.id);
      toast.success('检查完成。');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '检查暂时失败。');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <CourseSpacePageFrame>
      <CourseSpaceHeader
        courseId={courseId}
        courseTitle={data?.course.name ?? '课程作业'}
        courseMeta={data?.course.courseCode ?? undefined}
        role={role}
        active="assignments"
        previewMode={previewMode}
      />
      <main className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-950 dark:text-white">
              <ClipboardCheck className="size-5 text-sky-600" />
              作业
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {role === 'teacher'
                ? '设置检查要点，查看学生提交和问题反馈。范本仅老师可见。'
                : '上传自己的作业，查看需要自行核查的地方。检查不会给出标准答案。'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1.5 size-4" />
            刷新
          </Button>
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            <AlertCircle className="mr-2 inline size-4" />
            {error}
          </div>
        ) : null}
        {loading ? (
          <p className="flex items-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            正在读取作业…
          </p>
        ) : (
          <div className="grid min-h-[min(680px,70dvh)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-semibold">{role === 'teacher' ? '作业设置' : '作业要求'}</h2>
                {role === 'teacher' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedId(null);
                      setTitle('');
                      setInstructions('');
                      setPublished(false);
                      setExemplarFile(null);
                      setRemoveExemplar(false);
                    }}
                  >
                    <Plus className="mr-1 size-4" />
                    新作业
                  </Button>
                ) : null}
              </div>
              {data?.assignments.length ? (
                <div className="mb-5 flex flex-wrap gap-2" aria-label="选择作业">
                  {data.assignments.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${selectedId === item.id ? 'border-sky-400 bg-sky-50 text-sky-900 dark:bg-sky-400/15 dark:text-sky-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300'}`}
                    >
                      {item.title}
                      {role === 'teacher' && !item.published ? ' · 草稿' : ''}
                    </button>
                  ))}
                </div>
              ) : role === 'student' ? (
                <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500 dark:bg-white/5">
                  老师还没有发布作业。
                </p>
              ) : null}
              {role === 'teacher' ? (
                <div className="space-y-4">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    作业标题
                    <Input
                      className="mt-1.5"
                      value={title}
                      maxLength={200}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="例如：第 3 周分析作业"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    检查要点与注意事项
                    <Textarea
                      className="mt-1.5 min-h-64 resize-y text-sm leading-6"
                      value={instructions}
                      maxLength={20000}
                      onChange={(event) => setInstructions(event.target.value)}
                      placeholder="写明作业要求、必须覆盖的内容、格式要求，以及老师希望重点检查的问题。"
                    />
                  </label>
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 dark:border-white/15">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="size-4 text-sky-600" />
                      老师范本（可选、学生不可见）
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      可上传 PDF、DOCX、TXT、Markdown 或清晰图片，最大 4 MB。也可以只填写检查要点。
                    </p>
                    {selected?.exemplarFileName ? (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <a
                          className="inline-flex items-center gap-1 text-xs text-sky-700 underline"
                          href={`${base}/${encodeURIComponent(selected.id)}?download=exemplar`}
                        >
                          <Download className="size-3.5" />
                          当前范本：{selected.exemplarFileName}
                        </a>
                        <label className="flex items-center gap-1 text-xs text-slate-500">
                          <input
                            type="checkbox"
                            checked={removeExemplar}
                            onChange={(event) => setRemoveExemplar(event.target.checked)}
                          />
                          移除范本
                        </label>
                      </div>
                    ) : null}
                    <input
                      aria-label="上传老师范本"
                      type="file"
                      accept={ASSIGNMENT_ACCEPT}
                      className="mt-3 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sky-800"
                      onChange={(event) => setExemplarFile(event.target.files?.[0] ?? null)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={published}
                      onChange={(event) => setPublished(event.target.checked)}
                    />
                    发布给学生
                  </label>
                  <Button onClick={() => void saveAssignment()} disabled={saving}>
                    <Save className="mr-1.5 size-4" />
                    {saving ? '保存中…' : selected ? '保存修改' : '创建作业'}
                  </Button>
                </div>
              ) : selected ? (
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">{selected.title}</h3>
                  <div className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700 dark:bg-white/5 dark:text-slate-200">
                    {selected.instructions}
                  </div>
                </div>
              ) : null}
            </section>
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-5">
              <h2 className="font-semibold">
                {role === 'teacher' ? '学生提交与检查' : '我的提交与检查'}
              </h2>
              {!selected ? (
                <p className="mt-5 text-sm text-slate-500">
                  {role === 'teacher' ? '选择或创建作业后查看提交。' : '请选择作业。'}
                </p>
              ) : (
                <>
                  {role === 'student' ? (
                    <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-4 dark:border-sky-400/15 dark:bg-sky-400/10">
                      <p className="text-sm font-medium">上传作业文件</p>
                      <p className="mt-1 text-xs text-slate-500">
                        支持 PDF、DOCX、TXT、Markdown、PNG 和 JPG，最大 4
                        MB。检查只指出问题位置与类型。
                      </p>
                      <input
                        aria-label="上传学生作业"
                        type="file"
                        accept={ASSIGNMENT_ACCEPT}
                        className="mt-3 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2"
                        onChange={(event) => setStudentFile(event.target.files?.[0] ?? null)}
                      />
                      <Button
                        className="mt-3"
                        disabled={!studentFile || checking}
                        onClick={() => void submitAssignment()}
                      >
                        <Upload className="mr-1.5 size-4" />
                        {checking ? '上传并检查中…' : '上传并检查'}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      共 {selected.submissionCount ?? 0} 次提交。这里展示最近 100 次。
                    </p>
                  )}
                  <div className="mt-5 space-y-3">
                    {submissions.length ? (
                      submissions.map((submission) => (
                        <article
                          key={submission.id}
                          className="rounded-xl border border-slate-200 p-4 dark:border-white/10"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              {role === 'teacher' ? (
                                <p className="text-xs font-medium text-slate-500">
                                  {submission.student?.name || submission.student?.email || '学生'}
                                </p>
                              ) : null}
                              <p className="flex items-center gap-1.5 break-all text-sm font-medium">
                                <FileText className="size-4 shrink-0 text-sky-600" />
                                {submission.fileName}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                {formatDate(submission.createdAt)} ·{' '}
                                {submission.reviewStatus === 'complete'
                                  ? '检查完成'
                                  : submission.reviewStatus === 'error'
                                    ? '检查失败'
                                    : '检查中'}
                              </p>
                            </div>
                            <a
                              className="inline-flex items-center gap-1 text-xs text-sky-700 underline dark:text-sky-300"
                              href={`${base}/${encodeURIComponent(selected.id)}/submissions/${encodeURIComponent(submission.id)}?download=1`}
                            >
                              <Download className="size-3.5" />
                              下载原件
                            </a>
                          </div>
                          {submission.reviewStatus === 'error' ? (
                            <div className="mt-3 text-sm text-rose-700">
                              {submission.reviewError || '检查暂时失败。'}
                              <Button
                                variant="outline"
                                size="sm"
                                className="ml-2"
                                disabled={retryingId === submission.id}
                                onClick={() => void retryReview(submission.id)}
                              >
                                {retryingId === submission.id ? '重试中…' : '重试检查'}
                              </Button>
                            </div>
                          ) : null}
                          {submission.reviewStatus === 'pending' ? (
                            <p className="mt-3 text-sm text-slate-500">正在检查，请稍后刷新。</p>
                          ) : null}
                          <FeedbackPanel feedback={submission.feedbackJson} />
                        </article>
                      ))
                    ) : (
                      <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/5">
                        还没有提交记录。
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </CourseSpacePageFrame>
  );
}
