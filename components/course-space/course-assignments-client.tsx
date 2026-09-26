'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  AlertCircle,
  ClipboardCheck,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { CourseSpaceHeader } from '@/components/course-space/course-space-header';
import { CourseSpacePageFrame } from '@/components/course-space/course-space-page-frame';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { aiFetch } from '@/lib/ai-progress/ai-fetch';
import { useReportAiActivity } from '@/lib/ai-progress/use-ai-activity';
import { ASSIGNMENT_ACCEPT } from '@/lib/course-assignments/file-types';
import { toast } from '@/lib/notifications/client-toast';

type Role = 'teacher' | 'student';
type Feedback = {
  reviewVersion?: number;
  summary: string;
  issues: Array<{
    line?: number;
    page?: number;
    paragraph?: number;
    severity: 'attention' | 'important';
    message: string;
    observation?: string;
    selfCheck?: string;
  }>;
  checkedAt: string;
};
type Assignment = {
  id: string;
  title: string;
  instructions?: string;
  schoolTaskText?: string | null;
  schoolFileName?: string | null;
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
type PreviewFile = { assignmentId: string; kind: 'school' | 'exemplar'; fileName: string };

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
              key={`${issue.page ?? issue.paragraph ?? issue.line}-${index}`}
              className="rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <span className="mr-2 font-semibold text-sky-700 dark:text-sky-300">
                {issue.page != null
                  ? `第 ${issue.page} 页`
                  : issue.paragraph != null
                    ? `第 ${issue.paragraph} 段`
                    : issue.line != null
                      ? `第 ${issue.line} 行`
                      : '需检查'}
              </span>
              {issue.observation && issue.selfCheck ? (
                <span className="inline-block align-top">
                  <span>{issue.observation}</span>
                  <span className="mt-1 block text-slate-600 dark:text-slate-300">
                    自查：{issue.selfCheck}
                  </span>
                </span>
              ) : (
                issue.message
              )}
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

function SubmissionCard({
  submission,
  assignmentId,
  base,
  role,
  retryingId,
  onRetry,
}: {
  submission: Submission;
  assignmentId: string;
  base: string;
  role: Role;
  retryingId: string | null;
  onRetry: (id: string) => void;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
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
          href={`${base}/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(submission.id)}?download=1`}
        >
          <Download className="size-3.5" />
          下载提交文件
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
            onClick={() => onRetry(submission.id)}
          >
            {retryingId === submission.id ? '重试中…' : '重试检查'}
          </Button>
        </div>
      ) : null}
      {submission.reviewStatus === 'complete' &&
      (submission.feedbackJson?.reviewVersion ?? 1) < 2 ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={retryingId === submission.id}
          onClick={() => onRetry(submission.id)}
        >
          {retryingId === submission.id ? '重新检查中…' : '更新检查结果'}
        </Button>
      ) : null}
      {submission.reviewStatus === 'pending' ? (
        <p className="mt-3 text-sm text-slate-500">正在检查，请稍后刷新。</p>
      ) : null}
      <FeedbackPanel
        feedback={submission.reviewStatus === 'complete' ? submission.feedbackJson : null}
      />
    </article>
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
  const [dialogMode, setDialogMode] = useState<'view' | 'compose' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [schoolTaskText, setSchoolTaskText] = useState('');
  const [schoolFile, setSchoolFile] = useState<File | null>(null);
  const [removeSchoolFile, setRemoveSchoolFile] = useState(false);
  const [exemplarFile, setExemplarFile] = useState<File | null>(null);
  const [removeExemplar, setRemoveExemplar] = useState(false);
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  useReportAiActivity(saving || checking || Boolean(retryingId));

  const base = `/api/courses/${encodeURIComponent(courseId)}/assignments`;
  const selected = data?.assignments.find((item) => item.id === selectedId) ?? null;
  const previewUrl = previewFile
    ? `${base}/${encodeURIComponent(previewFile.assignmentId)}?preview=${previewFile.kind}`
    : '';
  const visualPreview = previewFile ? /\.(pdf|png|jpe?g)$/i.test(previewFile.fileName) : false;

  useEffect(() => {
    setPreviewText(null);
    setPreviewError('');
    if (!previewFile || visualPreview) return;
    const controller = new AbortController();
    void fetch(previewUrl, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('文件预览读取失败。');
        setPreviewText(await response.text());
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setPreviewError(cause instanceof Error ? cause.message : '文件预览读取失败。');
      });
    return () => controller.abort();
  }, [previewFile, previewUrl, visualPreview]);

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
              schoolTaskText: '学校布置：完成第一周习题，展示主要推导过程。',
              published: true,
              version: 1,
              submissionCount: 0,
            },
          ],
        });
        setSelectedId(role === 'student' ? 'preview-assignment' : (preferredId ?? null));
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
            : role === 'student'
              ? (result.assignments[0]?.id ?? null)
              : null;
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

  function openComposer(assignment?: Assignment) {
    setEditingId(assignment?.id ?? null);
    setTitle(assignment?.title ?? '');
    setInstructions(assignment?.instructions ?? '');
    setSchoolTaskText(assignment?.schoolTaskText ?? '');
    setSchoolFile(null);
    setRemoveSchoolFile(false);
    setExemplarFile(null);
    setRemoveExemplar(false);
    setDialogMode('compose');
  }

  function openDetail(assignment: Assignment) {
    setSelectedId(assignment.id);
    setDialogMode('view');
  }

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
      form.set('schoolTaskText', schoolTaskText.trim());
      form.set('published', 'true');
      if (schoolFile) form.set('schoolFile', schoolFile);
      if (removeSchoolFile) form.set('removeSchoolFile', 'true');
      if (exemplarFile) form.set('file', exemplarFile);
      if (removeExemplar) form.set('removeExemplar', 'true');
      const result = await responseData<{ id?: string }>(
        await fetch(editingId ? `${base}/${encodeURIComponent(editingId)}` : base, {
          method: editingId ? 'PATCH' : 'POST',
          body: form,
        }),
      );
      setDialogMode(null);
      await load(result.id ?? editingId ?? null);
      toast.success(
        editingId ? '学校作业已更新，学生现在可以看到。' : '学校作业已添加，学生现在可以看到。',
      );
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
      setUploadKey((value) => value + 1);
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
                ? '录入学校老师布置的作业，检查学生已完成的作答。'
                : '查看学校作业、上传自己的作答，获得需要自行核查的问题提示。'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-1.5 size-4" />
              刷新
            </Button>
            {role === 'teacher' ? (
              <Button size="sm" onClick={() => openComposer()}>
                <Plus className="mr-1.5 size-4" />
                添加学校作业
              </Button>
            ) : null}
          </div>
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
        ) : role === 'teacher' ? (
          <section className="min-h-[min(620px,70dvh)] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-semibold">学校作业</h2>
              <span className="text-xs text-slate-500">{data?.assignments.length ?? 0} 份</span>
            </div>
            {data?.assignments.length ? (
              <div className="space-y-3" aria-label="作业列表">
                {data.assignments.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openDetail(item)}
                    className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-4 text-left transition hover:border-sky-300 hover:bg-sky-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-white/10 dark:hover:bg-white/5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{item.title}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${item.published ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300'}`}
                        >
                          {item.published ? '学生可见' : '草稿'}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {item.schoolFileName ? `学校作业原件：${item.schoolFileName} · ` : ''}
                        {item.submissionCount ?? 0} 次学生提交
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 text-center dark:border-white/10">
                <ClipboardCheck className="mb-3 size-8 text-slate-300" />
                <p className="font-medium">还没有录入学校作业</p>
                <p className="mt-1 text-sm text-slate-500">
                  点击右上角「添加学校作业」录入原件和内部检查要点。
                </p>
              </div>
            )}
          </section>
        ) : (
          <div className="grid min-h-[min(680px,72dvh)] gap-4 md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]">
            <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
              <h2 className="mb-4 font-semibold">作业列表</h2>
              {data?.assignments.length ? (
                <nav className="space-y-2" aria-label="选择作业">
                  {data.assignments.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id);
                        setStudentFile(null);
                      }}
                      aria-current={selectedId === item.id ? 'page' : undefined}
                      className={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${selectedId === item.id ? 'border-sky-300 bg-sky-50 font-semibold text-sky-900 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100' : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5'}`}
                    >
                      {item.title}
                    </button>
                  ))}
                </nav>
              ) : (
                <p className="text-sm text-slate-500">速成老师还没有录入学校作业。</p>
              )}
            </aside>
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
              {selected ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs font-medium text-sky-700 dark:text-sky-300">当前作业</p>
                    <h2 className="mt-1 text-xl font-semibold">{selected.title}</h2>
                  </div>
                  {selected.schoolTaskText || selected.schoolFileName ? (
                    <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                      <h3 className="text-sm font-semibold">学校布置的原始作业</h3>
                      {selected.schoolTaskText ? (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-200">
                          {selected.schoolTaskText}
                        </p>
                      ) : null}
                      {selected.schoolFileName ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPreviewFile({
                                assignmentId: selected.id,
                                kind: 'school',
                                fileName: selected.schoolFileName!,
                              })
                            }
                          >
                            <Eye className="mr-1.5 size-4" />
                            预览学校作业原件
                          </Button>
                          <a
                            className="inline-flex items-center gap-1.5 text-sky-700 underline dark:text-sky-300"
                            href={`${base}/${encodeURIComponent(selected.id)}?download=school`}
                          >
                            <Download className="size-4" />
                            下载 {selected.schoolFileName}
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-4 dark:border-sky-400/15 dark:bg-sky-400/10">
                    <h3 className="text-sm font-semibold">上传我的作业</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      请上传自己完成的作答。检查只指出需要核查的地方，不提供答案。支持
                      PDF、DOCX、图片、.py、.ipynb 及常见代码和文本文件，最大 4 MB。
                    </p>
                    <input
                      key={`${selected.id}:${uploadKey}`}
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
                  <div aria-live="polite">
                    <h3 className="mb-3 font-semibold">本次作业评估</h3>
                    {submissions[0] ? (
                      <SubmissionCard
                        submission={submissions[0]}
                        assignmentId={selected.id}
                        base={base}
                        role="student"
                        retryingId={retryingId}
                        onRetry={(id) => void retryReview(id)}
                      />
                    ) : (
                      <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/5">
                        上传作业后，这里会显示需要自行检查的地方；不会给出标准答案。
                      </p>
                    )}
                    {submissions.length > 1 ? (
                      <details className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-white/10">
                        <summary className="cursor-pointer text-sm font-medium">
                          过往提交（{submissions.length - 1}）
                        </summary>
                        <div className="mt-4 space-y-3">
                          {submissions.slice(1).map((submission) => (
                            <SubmissionCard
                              key={submission.id}
                              submission={submission}
                              assignmentId={selected.id}
                              base={base}
                              role="student"
                              retryingId={retryingId}
                              onRetry={(id) => void retryReview(id)}
                            />
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-64 items-center justify-center text-sm text-slate-500">
                  请先从左侧选择一份作业。
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {role === 'teacher' ? (
        <>
          <Dialog
            open={dialogMode === 'view'}
            onOpenChange={(open) => !open && setDialogMode(null)}
          >
            <DialogContent className="flex h-[min(820px,90dvh)] max-w-[min(900px,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden rounded-3xl p-0">
              <DialogHeader className="border-b border-slate-200 px-6 py-5 pr-14 dark:border-white/10">
                <DialogTitle className="text-lg">{selected?.title ?? '作业详情'}</DialogTitle>
                <DialogDescription>作业内容、检查要点及学生提交。</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {selected ? (
                  <>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs ${selected.published ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                    >
                      {selected.published ? '学生可见' : '草稿，学生不可见'}
                    </span>
                    {selected.schoolTaskText || selected.schoolFileName ? (
                      <div>
                        <h3 className="font-semibold">学校布置的原始作业</h3>
                        {selected.schoolTaskText ? (
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">
                            {selected.schoolTaskText}
                          </p>
                        ) : null}
                        {selected.schoolFileName ? (
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setPreviewFile({
                                  assignmentId: selected.id,
                                  kind: 'school',
                                  fileName: selected.schoolFileName!,
                                })
                              }
                            >
                              <Eye className="mr-1.5 size-4" />
                              预览原件
                            </Button>
                            <a
                              className="inline-flex items-center gap-1.5 text-sm text-sky-700 underline"
                              href={`${base}/${encodeURIComponent(selected.id)}?download=school`}
                            >
                              <Download className="size-4" />
                              下载 {selected.schoolFileName}
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div>
                      <h3 className="font-semibold">内部检查要点（学生不可见）</h3>
                      <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-7 dark:bg-white/5">
                        {selected.instructions}
                      </p>
                    </div>
                    {selected.exemplarFileName ? (
                      <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-4 dark:border-sky-400/15 dark:bg-sky-400/10">
                        <p className="text-xs font-medium">仅老师可见的参考范本</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPreviewFile({
                                assignmentId: selected.id,
                                kind: 'exemplar',
                                fileName: selected.exemplarFileName!,
                              })
                            }
                          >
                            <Eye className="mr-1.5 size-4" />
                            预览范本
                          </Button>
                          <a
                            className="inline-flex items-center gap-1.5 text-sm text-sky-700 underline"
                            href={`${base}/${encodeURIComponent(selected.id)}?download=exemplar`}
                          >
                            <Download className="size-4" />
                            下载 {selected.exemplarFileName}
                          </a>
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <h3 className="font-semibold">
                        学生提交与检查（{selected.submissionCount ?? 0}）
                      </h3>
                      <div className="mt-3 space-y-3">
                        {submissions.length ? (
                          submissions.map((submission) => (
                            <SubmissionCard
                              key={submission.id}
                              submission={submission}
                              assignmentId={selected.id}
                              base={base}
                              role="teacher"
                              retryingId={retryingId}
                              onRetry={(id) => void retryReview(id)}
                            />
                          ))
                        ) : (
                          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/5">
                            还没有学生提交。
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
              <DialogFooter className="border-t border-slate-200 px-6 py-4 dark:border-white/10">
                <Button variant="outline" onClick={() => setDialogMode(null)}>
                  关闭
                </Button>
                {selected ? (
                  <Button onClick={() => openComposer(selected)}>编辑学校作业</Button>
                ) : null}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={dialogMode === 'compose'}
            onOpenChange={(open) => !open && !saving && setDialogMode(null)}
          >
            <DialogContent className="flex h-[min(860px,92dvh)] max-w-[min(800px,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden rounded-3xl p-0">
              <DialogHeader className="border-b border-slate-200 px-6 py-5 pr-14 dark:border-white/10">
                <DialogTitle className="text-lg">
                  {editingId ? '编辑学校作业' : '添加学校作业'}
                </DialogTitle>
                <DialogDescription>
                  作业由学校老师布置。速成老师录入原件和内部检查要点，学生只能看到学校作业和自己提交后的问题提示。
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <label className="block text-sm font-medium">
                  作业标题
                  <Input
                    className="mt-2"
                    value={title}
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="例如：第 3 周分析作业"
                  />
                </label>
                <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                  <h3 className="text-sm font-semibold">学校布置的作业原版（可选）</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    由速成老师上传学校老师给出的作业内容或原件，发布后学生可查看和下载。
                  </p>
                  <Textarea
                    aria-label="学校布置的作业内容"
                    className="mt-3 min-h-32 resize-y text-sm leading-6"
                    value={schoolTaskText}
                    maxLength={20000}
                    onChange={(event) => setSchoolTaskText(event.target.value)}
                    placeholder="粘贴学校老师给出的作业内容或要求；没有可留空。"
                  />
                  {editingId &&
                  data?.assignments.find((item) => item.id === editingId)?.schoolFileName ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPreviewFile({
                            assignmentId: editingId,
                            kind: 'school',
                            fileName: data.assignments.find((item) => item.id === editingId)!
                              .schoolFileName!,
                          })
                        }
                      >
                        <Eye className="mr-1.5 size-4" />
                        预览当前原件
                      </Button>
                      <a
                        className="inline-flex items-center gap-1 text-xs text-sky-700 underline"
                        href={`${base}/${encodeURIComponent(editingId)}?download=school`}
                      >
                        <Download className="size-3.5" />
                        当前原件：
                        {data.assignments.find((item) => item.id === editingId)?.schoolFileName}
                      </a>
                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        <input
                          type="checkbox"
                          checked={removeSchoolFile}
                          onChange={(event) => setRemoveSchoolFile(event.target.checked)}
                        />
                        移除原件
                      </label>
                    </div>
                  ) : null}
                  <input
                    aria-label="上传学校作业原件"
                    type="file"
                    accept={ASSIGNMENT_ACCEPT}
                    className="mt-3 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sky-800"
                    onChange={(event) => setSchoolFile(event.target.files?.[0] ?? null)}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    支持 PDF、DOCX、图片、.py、.ipynb 等代码和文本文件，最大 4 MB。
                  </p>
                </div>
                <label className="block text-sm font-medium">
                  内部检查要点（学生不可见）
                  <Textarea
                    className="mt-2 min-h-40 resize-y text-sm leading-6"
                    value={instructions}
                    maxLength={20000}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder="写明需要重点核查的内容、过程与格式要求；这些要点只用于内部检查。"
                  />
                </label>
                <div className="rounded-xl border border-dashed border-slate-300 p-4 dark:border-white/15">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="size-4 text-sky-600" />
                    老师参考范本（可选、学生不可见）
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    如有参考范本，可上传供内部比对；也可以只填写检查要点。范本不会显示给学生。
                  </p>
                  {editingId &&
                  data?.assignments.find((item) => item.id === editingId)?.exemplarFileName ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPreviewFile({
                            assignmentId: editingId,
                            kind: 'exemplar',
                            fileName: data.assignments.find((item) => item.id === editingId)!
                              .exemplarFileName!,
                          })
                        }
                      >
                        <Eye className="mr-1.5 size-4" />
                        预览当前范本
                      </Button>
                      <a
                        className="inline-flex items-center gap-1 text-xs text-sky-700 underline"
                        href={`${base}/${encodeURIComponent(editingId)}?download=exemplar`}
                      >
                        <Download className="size-3.5" />
                        当前范本：
                        {data.assignments.find((item) => item.id === editingId)?.exemplarFileName}
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
              </div>
              <DialogFooter className="border-t border-slate-200 px-6 py-4 dark:border-white/10">
                <Button variant="outline" disabled={saving} onClick={() => setDialogMode(null)}>
                  取消
                </Button>
                <Button disabled={saving} onClick={() => void saveAssignment()}>
                  {saving ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 size-4" />
                  )}
                  {saving ? '保存中…' : editingId ? '保存并开放给学生' : '添加并开放给学生'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      <Dialog open={Boolean(previewFile)} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="flex h-[min(900px,94dvh)] max-w-[min(1100px,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden rounded-3xl p-0">
          <DialogHeader className="border-b border-slate-200 px-6 py-5 pr-14 dark:border-white/10">
            <DialogTitle className="truncate text-lg">
              {previewFile?.fileName ?? '文件预览'}
            </DialogTitle>
            <DialogDescription>
              {previewFile?.kind === 'exemplar'
                ? '老师内部参考范本，学生不可见。'
                : '学校布置的作业原件。'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4 dark:bg-slate-950">
            {previewFile && visualPreview ? (
              <iframe
                title={`${previewFile.fileName} 预览`}
                src={previewUrl}
                className="h-full min-h-96 w-full rounded-xl border border-slate-200 bg-white dark:border-white/10"
              />
            ) : previewError ? (
              <p role="alert" className="p-4 text-sm text-rose-700">
                {previewError}
              </p>
            ) : previewText === null ? (
              <p className="flex items-center gap-2 p-4 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                正在读取文件预览…
              </p>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]">
                <p className="mb-3 text-xs text-slate-500">
                  便于浏览的文本预览；AI 检查会直接读取原文件。
                </p>
                {previewText ? (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-800 dark:text-slate-100">
                    {previewText}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    此文件没有可用的文本预览，请下载原件查看。
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-slate-200 px-6 py-4 dark:border-white/10">
            {previewFile ? (
              <a
                className="inline-flex items-center gap-1.5 text-sm text-sky-700 underline dark:text-sky-300"
                href={`${base}/${encodeURIComponent(previewFile.assignmentId)}?download=${previewFile.kind}`}
              >
                <Download className="size-4" />
                下载原文件
              </a>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CourseSpacePageFrame>
  );
}
