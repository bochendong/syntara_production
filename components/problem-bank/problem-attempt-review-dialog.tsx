'use client';

import { Check, Clock3, ImageIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CodeProblemStatement } from '@/components/problem-bank/code-problem-statement';
import { renderProblemContentStem } from '@/components/problem-bank/course-problem-bank-helpers';
import { ProblemImageAssets, ProblemRichText } from '@/components/problem-bank/problem-rich-text';
import {
  notebookProblemAttemptAnswerSchema,
  notebookProblemAttemptResultSchema,
  notebookProblemPublicContentSchema,
} from '@/lib/problem-bank';
import { cn } from '@/lib/utils';

export type TeacherStudentAttemptDetail = {
  id: string;
  kind: string;
  status: string;
  score: number | null;
  answer: unknown;
  result: unknown;
  activeDurationMs: number | null;
  timingSource: string | null;
  createdAt: number;
  problem: {
    id: string;
    title: string;
    type: string;
    difficulty: string;
    points: number;
    publicContent: unknown;
    chapterName?: string | null;
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
  passed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  partial: 'border-amber-200 bg-amber-50 text-amber-700',
  pending: 'border-slate-200 bg-slate-50 text-slate-600',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
};

function duration(value: number | null) {
  if (value == null) return '未记录用时';
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

export function ProblemAttemptAnswerView({ attempt }: { attempt: TeacherStudentAttemptDetail }) {
  const contentResult = notebookProblemPublicContentSchema.safeParse(attempt.problem.publicContent);
  const answerResult = notebookProblemAttemptAnswerSchema.safeParse(attempt.answer);
  const resultResult = notebookProblemAttemptResultSchema.safeParse(attempt.result);
  const content = contentResult.success ? contentResult.data : null;
  const answer = answerResult.success ? answerResult.data : null;
  const result = resultResult.success ? resultResult.data : null;

  if (!answer) return <p className="text-sm text-slate-500">这次提交的答案暂时无法显示。</p>;

  return (
    <div className="space-y-4">
      {content?.type === 'choice' ? (
        <div className="space-y-2">
          {content.options.map((option) => {
            const selected = answer.selectedOptionIds?.includes(option.id) || false;
            return (
              <div
                key={option.id}
                className={cn(
                  'flex items-start gap-3 rounded-xl border px-3 py-3 text-sm',
                  selected
                    ? 'border-primary/35 bg-primary/[0.07] text-slate-950 dark:text-white'
                    : 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-white',
                    selected ? 'border-primary bg-primary' : 'border-slate-300 bg-white',
                  )}
                >
                  {selected ? <Check className="size-3.5" /> : null}
                </span>
                <span className="shrink-0 font-semibold">{option.id}.</span>
                <ProblemRichText content={option.label} className="min-w-0 flex-1" />
              </div>
            );
          })}
          {!answer.selectedOptionIds?.length ? (
            <p className="text-sm text-slate-500">学生未选择任何选项。</p>
          ) : null}
        </div>
      ) : null}

      {content?.type === 'fill_blank' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {content.blanks.map((blank, index) => (
            <div
              key={blank.id}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <p className="text-xs text-slate-400">第 {index + 1} 空</p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
                {answer.blanks?.[blank.id] || '未填写'}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {answer.code != null ? (
        <pre className="max-h-[360px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
          {answer.code || '未提交代码'}
        </pre>
      ) : null}

      {answer.text != null ? (
        answer.text.trim() ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <ProblemRichText content={answer.text} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">学生未填写文字答案。</p>
        )
      ) : null}

      {answer.images?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {answer.images.map((image) => (
            <figure
              key={image.id}
              className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10"
            >
              <img
                src={image.dataUrl}
                alt={image.name}
                className="max-h-80 w-full bg-white object-contain"
              />
              <figcaption className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-white/10">
                <ImageIcon className="size-3.5" />
                {image.name}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {result?.feedback ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
          <p className="text-xs font-semibold text-slate-500">判题反馈</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
            {result.feedback}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ProblemAttemptReviewDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attempt: TeacherStudentAttemptDetail | null;
}) {
  const attempt = props.attempt;
  const parsed = attempt
    ? notebookProblemPublicContentSchema.safeParse(attempt.problem.publicContent)
    : null;
  const content = parsed?.success ? parsed.data : null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-[min(1100px,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-14 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="mr-auto">{attempt?.problem.title || '提交详情'}</DialogTitle>
            {attempt ? (
              <Badge variant="outline" className={STATUS_STYLES[attempt.status]}>
                {STATUS_LABELS[attempt.status] || attempt.status}
              </Badge>
            ) : null}
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {attempt ? new Date(attempt.createdAt).toLocaleString('zh-CN') : ''}
            {attempt ? (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3.5" />
                {duration(attempt.activeDurationMs)}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {attempt ? (
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:overflow-hidden">
            <section className="min-w-0 space-y-5 border-b border-slate-200 p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r dark:border-white/10">
              {attempt.problem.chapterName ? (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{attempt.problem.chapterName}</Badge>
                </div>
              ) : null}
              {content?.type === 'code' ? (
                <CodeProblemStatement content={content} locale="zh-CN" />
              ) : content ? (
                <ProblemRichText content={renderProblemContentStem(content)} />
              ) : (
                <p className="text-sm text-slate-500">题面暂时无法显示。</p>
              )}
              <ProblemImageAssets content={content} className="sm:grid-cols-1" />
            </section>
            <section className="min-w-0 bg-slate-50/70 p-5 lg:overflow-y-auto dark:bg-slate-950/60">
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  学生作答
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  本次得分{' '}
                  {attempt.score == null ? '暂无' : `${attempt.score} / ${attempt.problem.points}`}
                </p>
              </div>
              <ProblemAttemptAnswerView attempt={attempt} />
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
