'use client';

import { AlertCircle, CheckCircle2, ChevronDown, Copy } from 'lucide-react';
import { useState } from 'react';
import { highlightCode } from '@/components/problem-bank/code-answer-editor';
import { ProblemRichText } from '@/components/problem-bank/problem-rich-text';
import { toast } from '@/lib/notifications/client-toast';
import type {
  NotebookProblemAttemptAnswer,
  NotebookProblemAttemptResult,
  NotebookProblemPartAnswer,
  NotebookProblemPartResult,
} from '@/lib/problem-bank';
import { cn } from '@/lib/utils';

type Locale = 'zh-CN' | 'en-US';
type CaseResult = NonNullable<NotebookProblemAttemptResult['caseResults']>[number];

const zh = (locale: Locale, cn: string, en: string) => (locale === 'zh-CN' ? cn : en);

function codeFileName(language?: string) {
  const lang = (language || 'python').toLowerCase();
  if (lang === 'racket') return 'submission.rkt';
  if (lang === 'java') return 'Submission.java';
  if (lang === 'c') return 'submission.c';
  if (lang === 'cpp' || lang === 'c++') return 'submission.cpp';
  if (lang === 'javascript' || lang === 'js') return 'submission.js';
  return 'submission.py';
}

/** 提交的代码：行号 + 按题目语言高亮（Racket 不再显示成 .py）。 */
export function AttemptCodeView({
  code,
  language,
  locale,
  maxHeight = '55vh',
}: {
  code: string;
  language?: string;
  locale: Locale;
  maxHeight?: string;
}) {
  const lines = code.split('\n');
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900 dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800">
        <span className="font-mono text-xs text-slate-600">
          {codeFileName(language)} · {lines.length} {zh(locale, '行', 'lines')}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              toast.success(zh(locale, '代码已复制', 'Code copied'));
            } catch {
              toast.error(zh(locale, '复制失败，请手动选择代码复制', 'Copy failed'));
            }
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          {zh(locale, '复制', 'Copy')}
        </button>
      </div>
      <div
        className="grid grid-cols-[3rem_minmax(0,1fr)] overflow-auto font-mono text-[13px] leading-6"
        style={{ tabSize: 4, maxHeight }}
      >
        <pre
          aria-hidden="true"
          className="sticky left-0 select-none border-r border-slate-200 bg-slate-50 px-2 py-3 text-right text-slate-400"
        >
          {lines.map((_, i) => i + 1).join('\n')}
        </pre>
        <pre className="min-w-max whitespace-pre px-4 py-3">
          <code>{highlightCode(code, language)}</code>
        </pre>
      </div>
    </div>
  );
}

/** 测试用例逐条结果：没通过的展开显示实际输出 / 报错，通过的折叠成一行。 */
export function AttemptCaseList({
  cases,
  locale,
  title,
}: {
  cases: CaseResult[];
  locale: Locale;
  title?: string;
}) {
  const [showPassed, setShowPassed] = useState(false);
  if (!cases.length) return null;
  const failed = cases.filter((item) => !item.passed);
  const passed = cases.filter((item) => item.passed);
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2 text-xs leading-5 dark:border-slate-800">
      <p className="mb-1.5 font-semibold text-slate-600 dark:text-slate-300">
        {title ?? zh(locale, '公开测试用例', 'Public test cases')} · {passed.length}/{cases.length}
      </p>
      <ul className="space-y-2">
        {failed.map((item, index) => (
          <li key={`${item.id}-${index}`} className="flex gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="break-words font-mono text-slate-700 dark:text-slate-200">
                {item.description || item.id}
              </p>
              {item.actual ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {zh(locale, '实际：', 'Actual: ')}
                  {item.actual}
                </pre>
              ) : null}
              {item.error ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-rose-50 px-2 py-1 font-mono text-[11px] text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
                  {item.error}
                </pre>
              ) : null}
              {item.stdout ? (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-500 dark:bg-slate-900">
                  {item.stdout}
                </pre>
              ) : null}
            </div>
          </li>
        ))}
        {passed.length ? (
          <li>
            <button
              type="button"
              onClick={() => setShowPassed((value) => !value)}
              className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {zh(locale, `${passed.length} 个通过`, `${passed.length} passed`)}
              <ChevronDown className={cn('h-3.5 w-3.5 transition', showPassed && 'rotate-180')} />
            </button>
            {showPassed ? (
              <ul className="mt-1 space-y-0.5 pl-5 font-mono text-slate-500">
                {passed.map((item, index) => (
                  <li key={`${item.id}-${index}`} className="break-words">
                    {item.description || item.id}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

const PART_STATUS: Record<string, { zh: string; en: string; tone: string }> = {
  passed: { zh: '正确', en: 'Correct', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  partial: { zh: '部分正确', en: 'Partial', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  failed: { zh: '错误', en: 'Wrong', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  error: { zh: '判题异常', en: 'Error', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  pending: { zh: '未批改', en: 'Not graded', tone: 'bg-slate-50 text-slate-600 ring-slate-200' },
};

function PartAnswerView({
  answer,
  language,
  locale,
}: {
  answer: NotebookProblemPartAnswer | undefined;
  language?: string;
  locale: Locale;
}) {
  if (!answer) {
    return (
      <p className="text-xs text-slate-500">{zh(locale, '这一问没有作答。', 'Not answered.')}</p>
    );
  }
  return (
    <div className="space-y-2">
      {answer.selectedOptionIds?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {answer.selectedOptionIds.map((id) => (
            <span
              key={id}
              className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-100"
            >
              {id}
            </span>
          ))}
        </div>
      ) : null}
      {answer.blanks && Object.keys(answer.blanks).length ? (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {Object.entries(answer.blanks).map(([id, value], index) => (
            <span key={id} className="rounded-md border border-slate-200 px-2 py-0.5">
              {zh(locale, `第 ${index + 1} 空`, `Blank ${index + 1}`)}：{value || '—'}
            </span>
          ))}
        </div>
      ) : null}
      {answer.cells && Object.keys(answer.cells).length ? (
        <AttemptCellsView cells={answer.cells} locale={locale} />
      ) : null}
      {answer.code?.trim() ? (
        <AttemptCodeView code={answer.code} language={language} locale={locale} maxHeight="40vh" />
      ) : null}
      {answer.text?.trim() ? (
        <ProblemRichText content={answer.text} className="text-sm leading-6" />
      ) : null}
      {answer.images?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {answer.images.map((image) => (
            <img
              key={image.id}
              src={image.dataUrl}
              alt={image.name}
              className="max-h-48 w-full rounded-md border border-slate-200 bg-white object-contain"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 表格题作答：key 是 `${rowId}:${colId}`。 */
export function AttemptCellsView({
  cells,
  results,
  locale,
}: {
  cells: Record<string, string>;
  results?: Array<{ key: string; correct: boolean; expected?: string }>;
  locale: Locale;
}) {
  const verdict = new Map((results ?? []).map((item) => [item.key, item]));
  return (
    <div className="overflow-auto rounded-md border border-slate-200 text-xs">
      <table className="w-full">
        <tbody>
          {Object.entries(cells).map(([key, value]) => {
            const item = verdict.get(key);
            return (
              <tr key={key} className="border-b border-slate-100 last:border-0">
                <td className="whitespace-nowrap px-2 py-1 font-mono text-slate-500">{key}</td>
                <td
                  className={cn(
                    'px-2 py-1 font-mono',
                    item?.correct === true && 'text-emerald-700',
                    item?.correct === false && 'text-rose-700',
                  )}
                >
                  {value || '—'}
                  {item?.correct === false && item.expected
                    ? zh(locale, `（应为 ${item.expected}）`, ` (expected ${item.expected})`)
                    : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 分小问的大题：每一问的作答、得分、测试和批改反馈。 */
export function AttemptPartsDetail({
  answer,
  result,
  language,
  locale,
}: {
  answer: NotebookProblemAttemptAnswer;
  result?: NotebookProblemAttemptResult;
  language?: string;
  locale: Locale;
}) {
  const results = result?.parts ?? [];
  const labels = Array.from(
    new Set([...results.map((part) => part.label), ...Object.keys(answer.parts ?? {})]),
  );
  if (!labels.length) return null;
  const byLabel = new Map<string, NotebookProblemPartResult>(
    results.map((part) => [part.label, part]),
  );
  return (
    <div className="space-y-3">
      {labels.map((label) => {
        const part = byLabel.get(label);
        const status = PART_STATUS[part?.status ?? 'pending'] ?? PART_STATUS.pending;
        return (
          <section
            key={label}
            className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
          >
            <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900/50">
              <span className="text-sm font-semibold">({label})</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
                  status.tone,
                )}
              >
                {locale === 'zh-CN' ? status.zh : status.en}
              </span>
              {part ? (
                <span className="ml-auto font-mono text-xs text-slate-600">
                  {Math.round(part.score * 100) / 100}/{part.points}
                </span>
              ) : null}
            </header>
            <div className="space-y-2 p-3">
              <PartAnswerView answer={answer.parts?.[label]} language={language} locale={locale} />
              {part?.publicSummary || part?.secretSummary ? (
                <p className="text-xs text-slate-600">
                  {part.publicSummary
                    ? zh(
                        locale,
                        `公开测试 ${part.publicSummary.passed}/${part.publicSummary.total}`,
                        `Public ${part.publicSummary.passed}/${part.publicSummary.total}`,
                      )
                    : ''}
                  {part.publicSummary && part.secretSummary ? ' · ' : ''}
                  {part.secretSummary
                    ? zh(
                        locale,
                        `隐藏测试 ${part.secretSummary.passed}/${part.secretSummary.total}`,
                        `Secret ${part.secretSummary.passed}/${part.secretSummary.total}`,
                      )
                    : ''}
                </p>
              ) : null}
              {part?.caseResults?.length ? (
                <AttemptCaseList cases={part.caseResults} locale={locale} />
              ) : null}
              {part?.cells?.length && answer.parts?.[label]?.cells ? (
                <AttemptCellsView
                  cells={answer.parts[label].cells ?? {}}
                  results={part.cells}
                  locale={locale}
                />
              ) : null}
              {part?.feedback ? (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 dark:bg-slate-900/50">
                  <ProblemRichText content={part.feedback} />
                </div>
              ) : null}
              {part?.analysis ? (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 dark:bg-slate-900/50">
                  <ProblemRichText content={part.analysis} />
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 题目里代码的语言：代码题直接取，分小问取第一个代码小问的。 */
export function attemptCodeLanguage(content: unknown): string | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const record = content as {
    type?: string;
    language?: string;
    parts?: Array<{ content?: { type?: string; language?: string } }>;
  };
  if (record.type === 'code') return record.language;
  if (record.type === 'multipart') {
    return record.parts?.find((part) => part.content?.type === 'code')?.content?.language;
  }
  return undefined;
}
