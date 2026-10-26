'use client';

import { CheckCircle2, CornerDownRight, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { InteractiveFillBlank } from './interactive-fill-blank';
import { ProblemRichText } from './problem-rich-text';
import {
  formatPartLabel,
  isAutoGradedPartType,
  MULTIPART_PART_SUBMISSION_LIMIT,
  partAnswerIsEmpty,
  partPointShares,
  type NotebookProblemAttemptRecord,
  type NotebookProblemPart,
  type NotebookProblemPartAnswer,
  type NotebookProblemPartResult,
  type NotebookProblemPublicMultipart,
} from '@/lib/problem-bank';

type Locale = 'zh-CN' | 'en-US';

const PART_TYPE_LABELS: Record<NotebookProblemPart['content']['type'], [string, string]> = {
  choice: ['选择', 'Choice'],
  fill_blank: ['填空', 'Fill in'],
  calculation: ['计算', 'Calculation'],
  short_answer: ['简答', 'Short answer'],
  proof: ['证明', 'Proof'],
};

/** 小问状态 → 珠子颜色：绿对、粉错、琥珀部分对、蓝待批改、空心未做 */
export function partStatusTone(result: NotebookProblemPartResult | undefined) {
  if (!result || (result.status === 'pending' && !result.gradedAt)) return 'todo' as const;
  if (result.status === 'passed') return 'passed' as const;
  if (result.status === 'failed') return 'failed' as const;
  if (result.status === 'partial') return 'partial' as const;
  return 'pending' as const;
}

const TONE_CLASS = {
  todo: 'border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400',
  passed:
    'border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-400/60 dark:bg-emerald-500/20 dark:text-emerald-100',
  failed:
    'border-rose-400 bg-rose-100 text-rose-800 dark:border-rose-400/60 dark:bg-rose-500/20 dark:text-rose-100',
  partial:
    'border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-100',
  pending:
    'border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-100',
} as const;

function PartMarble({
  label,
  result,
  active,
  onClick,
}: {
  label: string;
  result?: NotebookProblemPartResult;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-full border px-2 text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition',
        TONE_CLASS[partStatusTone(result)],
        active && 'ring-2 ring-sky-400/60 ring-offset-1 dark:ring-offset-slate-950',
      )}
    >
      {label.replace(/^[(（]|[)）]$/g, '')}
    </button>
  );
}

/** 题号旁边的一串小珠子：每问一颗，颜色是这一问的状态 */
export function MultipartStatusStrip({
  content,
  results,
  activeLabel,
  onSelect,
  className,
}: {
  content: NotebookProblemPublicMultipart;
  results: NotebookProblemPartResult[];
  activeLabel?: string | null;
  onSelect?: (label: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {content.parts.map((part) => (
        <PartMarble
          key={part.label}
          label={part.label}
          result={results.find((item) => item.label === part.label)}
          active={activeLabel === part.label}
          onClick={onSelect ? () => onSelect(part.label) : undefined}
        />
      ))}
    </div>
  );
}

function PartAnswerControl({
  part,
  value,
  disabled,
  locale,
  onChange,
}: {
  part: NotebookProblemPart;
  value: NotebookProblemPartAnswer;
  disabled: boolean;
  locale: Locale;
  onChange: (next: NotebookProblemPartAnswer) => void;
}) {
  const content = part.content;
  if (content.type === 'choice') {
    const selected = value.selectedOptionIds ?? [];
    const multi = content.selectionMode === 'multiple';
    return (
      <div className="space-y-2">
        <ProblemRichText content={content.stem} />
        {content.options.map((option) => (
          <label
            key={option.id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-[15px] transition dark:border-slate-700',
              selected.includes(option.id)
                ? 'border-sky-300 bg-sky-50 dark:border-sky-500/50 dark:bg-sky-500/10'
                : 'border-slate-200 bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900/70',
            )}
          >
            <input
              className="mt-1 size-4 accent-sky-600"
              type={multi ? 'checkbox' : 'radio'}
              disabled={disabled}
              checked={selected.includes(option.id)}
              onChange={(event) => {
                const next = multi
                  ? event.target.checked
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id)
                  : [option.id];
                onChange({ ...value, selectedOptionIds: Array.from(new Set(next)) });
              }}
            />
            <span className="mt-0.5 shrink-0 font-medium">{option.id}.</span>
            <ProblemRichText content={option.label} className="min-w-0 flex-1" />
          </label>
        ))}
      </div>
    );
  }
  if (content.type === 'fill_blank') {
    return (
      <InteractiveFillBlank
        content={content}
        values={value.blanks ?? {}}
        disabled={disabled}
        locale={locale}
        onFocusBlank={() => undefined}
        onChangeBlank={(blankId, text) =>
          onChange({ ...value, blanks: { ...(value.blanks ?? {}), [blankId]: text } })
        }
      />
    );
  }
  return (
    <div className="space-y-2">
      <ProblemRichText content={content.stem} />
      <textarea
        value={value.text ?? ''}
        disabled={disabled}
        rows={content.type === 'calculation' ? 2 : 5}
        placeholder={
          content.type === 'calculation'
            ? locale === 'zh-CN'
              ? '写最终结果，公式可用 $...$'
              : 'Final result; use $...$ for math'
            : locale === 'zh-CN'
              ? '写下这一问的答案'
              : 'Your answer to this part'
        }
        onChange={(event) => onChange({ ...value, text: event.target.value })}
        className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-[15px] leading-7 shadow-none outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
    </div>
  );
}

/**
 * 大题作答区：每问一张卡，各自作答、各自提交、各自显示对错；
 * 共享题干在左栏（或上方）由外层渲染。
 */
export function MultipartAnswerPanel({
  content,
  drafts,
  latestAttempt,
  disabled,
  submitting,
  locale,
  onChangePart,
  onSubmit,
}: {
  content: NotebookProblemPublicMultipart;
  drafts: Record<string, NotebookProblemPartAnswer>;
  latestAttempt: NotebookProblemAttemptRecord | null;
  disabled: boolean;
  submitting: boolean;
  locale: Locale;
  onChangePart: (label: string, answer: NotebookProblemPartAnswer) => void;
  onSubmit: (labels?: string[]) => void;
}) {
  const zh = locale === 'zh-CN';
  const results = latestAttempt?.result?.parts ?? [];
  const savedAnswers = latestAttempt?.answer.parts ?? {};
  const shares = partPointShares(content.parts, 100);
  const dirtyLabels = content.parts
    .map((part) => part.label)
    .filter((label) => !partAnswerIsEmpty(drafts[label]));
  const scrollToPart = (label: string) =>
    document
      .getElementById(`multipart-part-${label}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="flex min-h-full flex-col gap-3">
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-lg bg-white/85 px-1 py-1.5 backdrop-blur dark:bg-slate-950/85">
        <MultipartStatusStrip content={content} results={results} onSelect={scrollToPart} />
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {zh
            ? `${results.filter((item) => item.status === 'passed').length}/${content.parts.length} 问答对`
            : `${results.filter((item) => item.status === 'passed').length}/${content.parts.length} correct`}
        </span>
      </div>
      {content.parts.map((part, index) => {
        const result = results.find((item) => item.label === part.label);
        const draft = drafts[part.label] ?? savedAnswers[part.label] ?? {};
        const used = result?.submissions ?? 0;
        const limited = isAutoGradedPartType(part.content.type);
        const exhausted = limited && used >= MULTIPART_PART_SUBMISSION_LIMIT;
        const tone = partStatusTone(result);
        return (
          <section
            key={part.label}
            id={`multipart-part-${part.label}`}
            className={cn(
              'scroll-mt-14 rounded-xl border bg-white p-3 shadow-sm dark:bg-slate-950',
              tone === 'passed'
                ? 'border-emerald-200 dark:border-emerald-500/30'
                : tone === 'failed'
                  ? 'border-rose-200 dark:border-rose-500/30'
                  : tone === 'partial'
                    ? 'border-amber-200 dark:border-amber-500/30'
                    : 'border-slate-200 dark:border-slate-700',
            )}
          >
            <header className="mb-2 flex flex-wrap items-center gap-2">
              <PartMarble label={part.label} result={result} />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {PART_TYPE_LABELS[part.content.type][zh ? 0 : 1]} ·{' '}
                {zh ? `${Math.round(shares[index])} 分` : `${Math.round(shares[index])} pts`}
              </span>
              {part.dependsOn?.length ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700 dark:bg-violet-500/10 dark:text-violet-200">
                  <CornerDownRight className="size-3" />
                  {zh
                    ? `接着 ${part.dependsOn.map(formatPartLabel).join('')} 的结果`
                    : `Uses ${part.dependsOn.map(formatPartLabel).join('')}`}
                </span>
              ) : null}
              {result?.gradedAt ? (
                <span className="ml-auto text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {Math.round(result.score * 10) / 10}/{Math.round(result.points)}
                </span>
              ) : null}
            </header>
            <PartAnswerControl
              part={part}
              value={draft}
              disabled={disabled || submitting || exhausted}
              locale={locale}
              onChange={(next) => onChangePart(part.label, next)}
            />
            {result?.feedback ? (
              <p
                className={cn(
                  'mt-2 rounded-md px-3 py-2 text-sm leading-6',
                  tone === 'passed'
                    ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100'
                    : tone === 'failed'
                      ? 'bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-100'
                      : 'bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-200',
                )}
              >
                {result.feedback}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              {limited ? (
                <span className="text-[11px] text-slate-400">
                  {zh
                    ? `已交 ${used}/${MULTIPART_PART_SUBMISSION_LIMIT} 次`
                    : `${used}/${MULTIPART_PART_SUBMISSION_LIMIT} submissions`}
                </span>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  disabled || submitting || exhausted || partAnswerIsEmpty(drafts[part.label])
                }
                onClick={() => onSubmit([part.label])}
                className="ml-auto h-7 gap-1 rounded-md px-2.5 text-xs"
              >
                {result?.status === 'passed' && partAnswerIsEmpty(drafts[part.label]) ? (
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {zh ? '提交这一问' : 'Submit part'}
              </Button>
            </div>
          </section>
        );
      })}
      <Button
        type="button"
        disabled={disabled || submitting || dirtyLabels.length === 0}
        onClick={() => onSubmit(dirtyLabels)}
        className="mt-1 h-9 gap-1.5 rounded-md bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {zh
          ? dirtyLabels.length > 0
            ? `提交 ${dirtyLabels.map(formatPartLabel).join('')}`
            : '全部提交'
          : dirtyLabels.length > 0
            ? `Submit ${dirtyLabels.map(formatPartLabel).join('')}`
            : 'Submit all'}
      </Button>
    </div>
  );
}
