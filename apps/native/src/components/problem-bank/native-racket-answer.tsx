import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { CodeAnswerEditor } from './code-answer-editor';
import { gradeNativeTable } from '../../data/table-grading';
import { readProblemCodeDraftRecord, saveProblemCodeDraft } from '../../data/problem-code-draft';
import type {
  NotebookProblemGradingTable,
  NotebookProblemPublicTable,
} from '../../../../../lib/problem-bank/schema';
import {
  checkRacketTemplate,
  parseRacketTableAnswer,
  racketTableAnswerSource,
  type RacketAnswerSpec,
} from '../../../../../lib/problem-bank/racket-answer';

export function NativeRacketAnswer({
  spec,
  content,
  grading,
  value,
  draftKey,
  activePanel,
  lastAttemptAt = 0,
  disabled,
  onChange,
}: {
  spec: RacketAnswerSpec;
  content: Record<string, unknown>;
  grading: Record<string, unknown>;
  value: { sourceCode?: string; cells?: Record<string, string>; text?: string };
  draftKey: string;
  activePanel: 'code' | 'tests';
  lastAttemptAt?: number;
  disabled: boolean;
  onChange: (code: string, cells: Record<string, string>) => void;
}) {
  const [checks, setChecks] = useState<Array<{
    name: string;
    passed: boolean;
    detail?: string;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const testSequence = useRef(0);
  const initial = () =>
    spec.mode === 'template'
      ? value.text || spec.starterCode || ''
      : (value.sourceCode ??
        racketTableAnswerSource(content as NotebookProblemPublicTable, spec, value.cells));
  const [code, setCode] = useState(initial);
  const edited = useRef(false);
  const change = useRef(onChange);
  change.current = onChange;
  const update = (next: string) => {
    testSequence.current++;
    edited.current = true;
    setCode(next);
    setChecks(null);
    setError(null);
    let cells: Record<string, string> = {};
    try {
      if (spec.mode !== 'template')
        cells = parseRacketTableAnswer(content as NotebookProblemPublicTable, spec, next).cells;
    } catch {}
    change.current(next, cells);
    try {
      saveProblemCodeDraft(localStorage, draftKey, next);
    } catch {
      setError('代码尚未保存到本机，请检查存储空间。');
    }
  };
  useEffect(() => {
    if (edited.current) return;
    let restored =
      spec.mode === 'template'
        ? value.text || spec.starterCode || ''
        : (value.sourceCode ??
          racketTableAnswerSource(content as NotebookProblemPublicTable, spec, value.cells));
    try {
      const draft = readProblemCodeDraftRecord(localStorage, draftKey);
      if (draft && draft.savedAt >= lastAttemptAt) restored = draft.code;
    } catch {
      setError('无法读取本机代码草稿。');
    }
    setCode(restored);
    let cells: Record<string, string> = {};
    try {
      if (spec.mode !== 'template')
        cells = parseRacketTableAnswer(content as NotebookProblemPublicTable, spec, restored).cells;
    } catch {}
    // A restored draft becomes the submitted source too; never submit stale cells.
    if (restored !== (spec.mode === 'template' ? value.text : value.sourceCode))
      change.current(restored, cells);
  }, [draftKey, lastAttemptAt, value.sourceCode, value.text, value.cells, content, spec]);
  const test = async () => {
    const sequence = ++testSequence.current;
    setChecking(true);
    setError(null);
    setChecks(null);
    try {
      if (spec.mode === 'template')
        setChecks(checkRacketTemplate(code, String(grading.referenceAnswer || ''), spec));
      else {
        const parsed = parseRacketTableAnswer(content as NotebookProblemPublicTable, spec, code);
        const result = await gradeNativeTable(
          content as NotebookProblemPublicTable,
          grading as unknown as NotebookProblemGradingTable,
          parsed.cells,
        );
        if (sequence === testSequence.current)
          setChecks(
            result.cells.map((item, i) => ({ name: `答案 ${i + 1}`, passed: item.correct })),
          );
      }
    } catch (cause) {
      if (sequence === testSequence.current)
        setError(cause instanceof Error ? cause.message : '检查失败，请重试。');
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {activePanel === 'tests' ? (
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm">代码检查</strong>
          <button
            type="button"
            className="pp-run-button"
            onClick={() => void test()}
            disabled={disabled || checking}
          >
            <Play size={13} />
            {checking ? '检查中…' : '运行测试'}
          </button>
        </div>
      ) : null}
      {activePanel === 'code' ? (
        <CodeAnswerEditor
          value={code}
          onChange={update}
          language="racket"
          disabled={disabled}
          locale="zh-CN"
          className="min-h-[380px] flex-1"
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {activePanel === 'tests' && checks ? (
        <div role="status" className="space-y-1 text-sm">
          <strong>
            通过 {checks.filter((c) => c.passed).length}/{checks.length} 项
          </strong>
          {checks.map((item, i) => (
            <p key={i} className={item.passed ? 'text-emerald-700' : 'text-red-700'}>
              {item.passed ? '✓' : '×'} {item.name}
              {item.detail ? `：${item.detail}` : ''}
            </p>
          ))}
        </div>
      ) : null}
      {activePanel === 'tests' && !checks && !error && !checking ? (
        <p className="text-sm text-slate-500">运行测试，检查当前代码中的答案和格式。</p>
      ) : null}
    </div>
  );
}
