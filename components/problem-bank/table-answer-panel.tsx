'use client';

import { useState } from 'react';
import { ArrowDownToLine, Loader2, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { highlightPython } from './code-answer-editor';
import { ProblemRichText } from './problem-rich-text';
import { CodeFileChips } from './code-files';
import { runPythonRowsInBrowser, type BrowserRowResult } from '@/lib/client/browser-python';
import {
  tableAnswerColumns,
  tableCellKey,
  tableRowCode,
  tableRunResultText,
  tableSetupNeedsDisplay,
  type NotebookProblemPublicTable,
  type NotebookTableColumn,
} from '@/lib/problem-bank';

type Locale = 'zh-CN' | 'en-US';

/**
 * 表格题作答：给定列只读（代码高亮），作答列是发光的输入格。
 * 常用答案（ERROR / NOTHING）一点就填；提交后每行可以真跑一下看实际输出。
 */
export function TableAnswerPanel({
  content,
  values,
  onChange,
  results,
  disabled,
  locale,
  showStem = true,
}: {
  content: NotebookProblemPublicTable;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /// 最近一次提交每格对不对
  results?: Map<string, boolean> | null;
  disabled?: boolean;
  locale: Locale;
  showStem?: boolean;
}) {
  const zh = locale === 'zh-CN';
  const answerColumns = tableAnswerColumns(content);
  const quickAnswers = content.quickAnswers?.length ? content.quickAnswers : ['ERROR', 'NOTHING'];
  const [runs, setRuns] = useState<Record<string, BrowserRowResult>>({});
  const [runningRow, setRunningRow] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const canRun = Boolean(content.runnable && results && results.size > 0);
  const total = content.rows.length * answerColumns.length;
  const filled = content.rows.reduce(
    (acc, row) =>
      acc +
      answerColumns.filter((column) => values[tableCellKey(row.id, column.id)]?.trim()).length,
    0,
  );

  const runRow = async (rowId: string) => {
    const code = tableRowCode(content, rowId);
    if (!code || runningRow) return;
    setRunningRow(rowId);
    setRunError(null);
    try {
      const [row] = await runPythonRowsInBrowser({
        rows: [{ id: rowId, code }],
        setup: content.setupCode,
        files: (content.files ?? []).filter((file) => file.role !== 'expected_output'),
      });
      if (row) setRuns((prev) => ({ ...prev, [rowId]: row }));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningRow(null);
    }
  };

  const copyFromAbove = (rowIndex: number) => {
    const previous = content.rows[rowIndex - 1];
    const row = content.rows[rowIndex];
    if (!previous || !row) return;
    for (const column of answerColumns) {
      const key = tableCellKey(row.id, column.id);
      if (!values[key]?.trim()) onChange(key, values[tableCellKey(previous.id, column.id)] ?? '');
    }
  };

  const traceTable = answerColumns.length > 1;

  return (
    <div className="space-y-3">
      {showStem ? <ProblemRichText content={content.stem} /> : null}
      {tableSetupNeedsDisplay(content) ? (
        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[13px] leading-6 text-slate-800">
          <code>{highlightPython(content.setupCode ?? '')}</code>
        </pre>
      ) : null}
      {content.files?.length ? (
        <CodeFileChips files={content.files.map((file) => ({ ...file }))} locale={locale} />
      ) : null}
      <div
        className="flex items-center justify-end gap-1"
        aria-label={zh ? `已填 ${filled}/${total}` : `${filled}/${total} filled`}
      >
        {content.rows.map((row) => {
          const keys = answerColumns.map((column) => tableCellKey(row.id, column.id));
          const done = keys.every((key) => values[key]?.trim());
          const verdicts = keys.map((key) => results?.get(key));
          const tone = verdicts.every((value) => value === true)
            ? 'passed'
            : verdicts.some((value) => value === false)
              ? 'failed'
              : done
                ? 'filled'
                : 'todo';
          return <RowMarble key={row.id} tone={tone} />;
        })}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gradient-to-b from-sky-50/90 to-white">
              {canRun || traceTable ? <th className="w-8" /> : null}
              {content.columns.map((column) => (
                <th
                  key={column.id}
                  className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600"
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, rowIndex) => (
              <tr key={row.id} className="align-top odd:bg-white even:bg-slate-50/40">
                {canRun || traceTable ? (
                  <td className="border-b border-slate-100 py-2 pl-2">
                    {canRun && tableRowCode(content, row.id) ? (
                      <button
                        type="button"
                        onClick={() => void runRow(row.id)}
                        aria-label={zh ? '运行这一行' : 'Run this row'}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sky-200 bg-gradient-to-br from-white via-sky-100 to-sky-300 text-sky-700 shadow-sm"
                      >
                        {runningRow === row.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-2.5 w-2.5 fill-current" />
                        )}
                      </button>
                    ) : traceTable && rowIndex > 0 && !disabled ? (
                      <button
                        type="button"
                        onClick={() => copyFromAbove(rowIndex)}
                        aria-label={zh ? '从上一行拷下来' : 'Copy from row above'}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <ArrowDownToLine className="h-3 w-3" />
                      </button>
                    ) : null}
                  </td>
                ) : null}
                {content.columns.map((column) =>
                  column.role === 'given' ? (
                    <td key={column.id} className="border-b border-slate-100 px-3 py-2">
                      <GivenCell column={column} value={row.cells[column.id] ?? ''} />
                    </td>
                  ) : (
                    <td key={column.id} className="border-b border-slate-100 px-2 py-1.5">
                      <AnswerCell
                        column={column}
                        value={values[tableCellKey(row.id, column.id)] ?? ''}
                        verdict={results?.get(tableCellKey(row.id, column.id))}
                        quickAnswers={quickAnswers}
                        disabled={disabled}
                        onChange={(next) => onChange(tableCellKey(row.id, column.id), next)}
                        actual={
                          runs[row.id]
                            ? column.cellKind === 'python_value' &&
                              runs[row.id].value !== null &&
                              !runs[row.id].errorType
                              ? (runs[row.id].value ?? '')
                              : tableRunResultText(runs[row.id])
                            : undefined
                        }
                      />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {runError ? <p className="text-xs text-rose-600">{runError}</p> : null}
    </div>
  );
}

function RowMarble({ tone }: { tone: 'todo' | 'filled' | 'passed' | 'failed' }) {
  return (
    <span
      className={cn(
        'h-2.5 w-2.5 rounded-full border transition-colors',
        tone === 'passed' &&
          'border-emerald-400 bg-gradient-to-br from-white via-emerald-300 to-emerald-500',
        tone === 'failed' &&
          'border-rose-400 bg-gradient-to-br from-white via-rose-300 to-rose-500',
        tone === 'filled' && 'border-sky-400 bg-gradient-to-br from-white via-sky-300 to-sky-500',
        tone === 'todo' && 'border-slate-300 bg-white/70',
      )}
    />
  );
}

function GivenCell({ column, value }: { column: NotebookTableColumn; value: string }) {
  if (
    column.cellKind === 'code' ||
    column.cellKind === 'python_value' ||
    column.cellKind === 'output'
  ) {
    return (
      <pre className="whitespace-pre font-mono text-[13px] leading-6 text-slate-800">
        <code>{column.cellKind === 'code' ? highlightPython(value) : value}</code>
      </pre>
    );
  }
  return <ProblemRichText content={value} className="text-sm" />;
}

function AnswerCell({
  column,
  value,
  verdict,
  quickAnswers,
  disabled,
  onChange,
  actual,
}: {
  column: NotebookTableColumn;
  value: string;
  verdict?: boolean;
  quickAnswers: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  actual?: string;
}) {
  const multiline = column.cellKind === 'output' || column.cellKind === 'text';
  const rows = Math.max(1, value.split('\n').length);
  const shared = cn(
    'block w-full min-w-[9rem] rounded-lg border bg-sky-50/50 px-2.5 py-1.5 font-mono text-[13px] leading-6 text-slate-900 outline-none transition placeholder:text-slate-300 focus:bg-white focus:shadow-[0_0_0_3px_rgba(56,189,248,0.25)] disabled:cursor-not-allowed',
    verdict === true
      ? 'border-emerald-300 bg-emerald-50/70'
      : verdict === false
        ? 'border-rose-300 bg-rose-50/70'
        : 'border-sky-200 focus:border-sky-400',
  );
  return (
    <div className="group space-y-1">
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => onChange(event.target.value)}
          className={cn(shared, 'resize-none')}
        />
      ) : (
        <input
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className={shared}
        />
      )}
      {quickAnswers.length > 0 && !disabled ? (
        <div className="flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          {quickAnswers.map((answer) => (
            <button
              key={answer}
              type="button"
              onClick={() => onChange(answer)}
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold',
                value === answer
                  ? 'border-sky-400 bg-sky-100 text-sky-800'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-sky-300 hover:text-sky-700',
              )}
            >
              {answer}
            </button>
          ))}
        </div>
      ) : null}
      {actual !== undefined ? (
        <pre className="whitespace-pre-wrap rounded-md bg-slate-900/90 px-2 py-1 font-mono text-[11px] leading-5 text-emerald-200">
          {actual}
        </pre>
      ) : null}
    </div>
  );
}
