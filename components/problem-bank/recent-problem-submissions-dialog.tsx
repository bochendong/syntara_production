'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Inbox, Loader2, RefreshCw, UsersRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ProblemAttemptAnswerView,
  type TeacherStudentAttemptDetail,
} from '@/components/problem-bank/problem-attempt-review-dialog';
import { LOCAL_DEMO_STUDENT_ROSTER } from '@/lib/teacher/local-demo-student-roster';
import { BackendApiError, backendJson } from '@/lib/utils/backend-api';
import type { NotebookProblemClientRecord } from '@/lib/utils/notebook-problem-api';
import { cn } from '@/lib/utils';

export type RecentProblemSubmission = TeacherStudentAttemptDetail & {
  student: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
};

const STATUS_LABELS: Record<string, string> = {
  passed: '通过',
  failed: '未通过',
  partial: '部分正确',
  pending: '处理中',
  error: '判题异常',
};

const STATUS_STYLES: Record<string, string> = {
  passed:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200',
  failed:
    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200',
  partial:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200',
  pending:
    'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
  error:
    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200',
};

function formatDuration(value: number | null) {
  if (value == null) return '未记录用时';
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

function localAnswer(problem: NotebookProblemClientRecord, index: number) {
  if (problem.publicContent.type === 'choice') {
    return {
      selectedOptionIds: problem.publicContent.options[index % 2]?.id
        ? [problem.publicContent.options[index % 2].id]
        : [],
    };
  }
  if (problem.publicContent.type === 'fill_blank') {
    return {
      blanks: Object.fromEntries(
        problem.publicContent.blanks.map((blank, blankIndex) => [
          blank.id,
          blankIndex === 0 ? '示例答案' : `${blankIndex + 1}`,
        ]),
      ),
    };
  }
  if (problem.publicContent.type === 'code') {
    return {
      code:
        problem.publicContent.starterCode?.trim() ||
        'def solve(value):\n    # 学生提交的示例代码\n    return value',
    };
  }
  return {
    text:
      index % 2 === 0
        ? '这是学生最近一次提交的示例作答。'
        : '我先列出条件，再根据题目要求逐步推导结论。',
  };
}

function localSubmissions(problem: NotebookProblemClientRecord): RecentProblemSubmission[] {
  return LOCAL_DEMO_STUDENT_ROSTER.slice(0, 6).map((student, index) => {
    const status = index % 3 === 0 ? 'passed' : index % 3 === 1 ? 'partial' : 'failed';
    return {
      id: `mock-recent-submission-${problem.id}-${index}`,
      kind: 'submit',
      status,
      score: status === 'passed' ? problem.points : status === 'partial' ? problem.points / 2 : 0,
      answer: localAnswer(problem, index),
      result: {
        feedback:
          status === 'passed'
            ? '关键步骤完整，答案符合题目要求。'
            : status === 'partial'
              ? '思路基本正确，但中间一步还需要补充说明。'
              : '当前答案遗漏了关键条件，请检查推导过程。',
      },
      activeDurationMs: 245_000 + index * 51_000,
      timingSource: 'active',
      createdAt: Date.now() - index * 38 * 60_000,
      student: { id: student.userId, name: student.name },
      problem: {
        id: problem.id,
        title: problem.title,
        type: problem.type,
        difficulty: problem.difficulty,
        points: problem.points,
        publicContent: problem.publicContent,
        chapterName: problem.chapterName ?? null,
      },
    };
  });
}

export function RecentProblemSubmissionsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  problem: NotebookProblemClientRecord | null;
  previewMode?: boolean;
}) {
  const [submissions, setSubmissions] = useState<RecentProblemSubmission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => submissions.find((submission) => submission.id === selectedId) ?? submissions[0] ?? null,
    [selectedId, submissions],
  );

  const loadSubmissions = useCallback(
    async (signal?: AbortSignal) => {
      if (!props.problem) return;
      setLoading(true);
      setError('');
      try {
        const next = props.previewMode
          ? localSubmissions(props.problem)
          : (
              await backendJson<{ submissions: RecentProblemSubmission[] }>(
                `/api/teacher/courses/${encodeURIComponent(props.courseId)}/problems/${encodeURIComponent(props.problem.id)}/recent-submissions?limit=20`,
                { signal },
              )
            ).submissions;
        setSubmissions(next);
        setSelectedId((current) =>
          current && next.some((submission) => submission.id === current)
            ? current
            : (next[0]?.id ?? null),
        );
      } catch (cause) {
        if (signal?.aborted) return;
        setSubmissions([]);
        setSelectedId(null);
        setError(
          cause instanceof BackendApiError || cause instanceof Error
            ? cause.message
            : '最近提交读取失败。',
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [props.courseId, props.previewMode, props.problem],
  );

  useEffect(() => {
    if (!props.open || !props.problem) return;
    const controller = new AbortController();
    void loadSubmissions(controller.signal);
    return () => controller.abort();
  }, [loadSubmissions, props.open, props.problem]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[min(780px,90dvh)] max-w-[min(1040px,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden rounded-3xl p-0">
        <DialogHeader className="border-b border-slate-200 bg-white px-5 py-4 pr-14 dark:border-white/10 dark:bg-slate-950">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
              <UsersRound className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold text-slate-950 dark:text-white">
                最近提交
              </DialogTitle>
              <DialogDescription className="mt-1 line-clamp-1">
                {props.problem?.title || '当前题目'}
              </DialogDescription>
            </div>
            <Badge variant="outline" className="mr-1 rounded-full font-normal">
              最近 {submissions.length} 条
            </Badge>
          </div>
        </DialogHeader>

        {loading ? (
          <div
            className="grid min-h-0 flex-1 place-items-center bg-slate-50/70 dark:bg-slate-950/70"
            role="status"
          >
            <div className="text-center text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="mx-auto mb-3 size-5 animate-spin text-sky-500" />
              正在读取班级最近提交…
            </div>
          </div>
        ) : error ? (
          <div className="grid min-h-0 flex-1 place-items-center bg-slate-50/70 px-6 text-center dark:bg-slate-950/70">
            <div>
              <p className="text-sm text-rose-700 dark:text-rose-200">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 gap-1.5 rounded-xl"
                onClick={() => void loadSubmissions()}
              >
                <RefreshCw className="size-3.5" />
                重新加载
              </Button>
            </div>
          </div>
        ) : submissions.length === 0 ? (
          <div className="grid min-h-0 flex-1 place-items-center bg-slate-50/70 px-6 text-center dark:bg-slate-950/70">
            <div className="max-w-sm">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200 dark:bg-white/[0.04] dark:ring-white/10">
                <Inbox className="size-5" />
              </span>
              <p className="mt-4 font-semibold text-slate-900 dark:text-white">还没有学生提交</p>
              <p className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-slate-400">
                学生完成这道题后，最新作答会按时间显示在这里。
              </p>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(220px,0.72fr)_minmax(0,1.28fr)] overflow-hidden md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-1">
            <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-slate-50/80 p-3 md:border-b-0 md:border-r dark:border-white/10 dark:bg-slate-950/70">
              <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                <span>按提交时间排序</span>
                <button
                  type="button"
                  onClick={() => void loadSubmissions()}
                  className="rounded-md p-1 transition hover:bg-white hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
                  aria-label="刷新最近提交"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                {submissions.map((submission) => {
                  const active = selected?.id === submission.id;
                  return (
                    <button
                      key={submission.id}
                      type="button"
                      onClick={() => setSelectedId(submission.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30',
                        active
                          ? 'border-sky-200 bg-white shadow-sm dark:border-sky-400/30 dark:bg-sky-400/10'
                          : 'border-transparent hover:border-slate-200 hover:bg-white dark:hover:border-white/10 dark:hover:bg-white/[0.04]',
                      )}
                    >
                      <Avatar size="sm">
                        {submission.student.avatarUrl ? (
                          <AvatarImage
                            src={submission.student.avatarUrl}
                            alt={submission.student.name}
                          />
                        ) : null}
                        <AvatarFallback>{submission.student.name.slice(0, 1)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                            {submission.student.name}
                          </span>
                          <span
                            className={cn(
                              'size-1.5 shrink-0 rounded-full',
                              submission.status === 'passed'
                                ? 'bg-emerald-500'
                                : submission.status === 'partial'
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500',
                            )}
                          />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {new Date(submission.createdAt).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                          {' · '}
                          {submission.score == null
                            ? '暂无得分'
                            : `${submission.score}/${submission.problem.points} 分`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="min-h-0 overflow-y-auto bg-white p-5 dark:bg-slate-950 sm:p-6">
              {selected ? (
                <div className="mx-auto max-w-2xl">
                  <div className="mb-5 flex flex-wrap items-start gap-3 border-b border-slate-200 pb-4 dark:border-white/10">
                    <Avatar>
                      {selected.student.avatarUrl ? (
                        <AvatarImage src={selected.student.avatarUrl} alt={selected.student.name} />
                      ) : null}
                      <AvatarFallback>{selected.student.name.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-950 dark:text-white">
                        {selected.student.name}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span>{new Date(selected.createdAt).toLocaleString('zh-CN')}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="size-3.5" />
                          {formatDuration(selected.activeDurationMs)}
                        </span>
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('rounded-full', STATUS_STYLES[selected.status])}
                    >
                      {selected.status === 'passed' ? (
                        <CheckCircle2 className="mr-1 size-3" />
                      ) : null}
                      {STATUS_LABELS[selected.status] || selected.status}
                    </Badge>
                  </div>
                  <div className="mb-4 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 dark:bg-white/[0.04]">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      本次得分
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {selected.score == null
                        ? '暂无'
                        : `${selected.score} / ${selected.problem.points}`}
                    </span>
                  </div>
                  <ProblemAttemptAnswerView attempt={selected} />
                </div>
              ) : null}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
