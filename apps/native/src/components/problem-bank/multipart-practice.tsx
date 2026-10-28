import { HandwritingAnswerInput } from './handwriting-answer-input';
import { visibleCodeTests } from '../../../../../lib/problem-bank/visible-code-tests';
import { useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, FlaskConical, Loader2, SendHorizontal } from 'lucide-react';

import {
  formatPartLabel,
  isAutoGradedPart,
  partAnswerHasContent,
  partDraftIsDirty,
  partBlankIds,
  PART_SUBMISSION_LIMIT,
  type LocalPartAnswer,
  type LocalPartResult,
  type LocalProblemPart,
} from '../../data/multipart-problem';
import { marbleImages } from '../../lib/learning-action-marbles';
import { GlassSpinner } from '../GlassLoadMore';
import { STATUS_MARBLES } from './answer-sheet';
import { ProblemRichText } from './problem-rich-text';
import { NativeTableAnswer } from './native-table-answer';
import { NativeCodeSlots } from './native-code-slots';
import { NativeCodePlayground } from './native-code-playground';
import { CodeAnswerEditor } from './code-answer-editor';
import {
  codeSlotTemplateFor,
  defaultCodeAnswerFor,
} from '../../../../../lib/problem-bank/code-slots';
import type {
  NotebookCodeFile,
  NotebookProblemPublicCode,
} from '../../../../../lib/problem-bank/schema';
import type { NotebookProblemPublicTable } from '../../../../../lib/problem-bank/schema';
import {
  usePartFormulaEditor,
  type PartFormulaHandle,
} from '../../../../../lib/problem-bank/use-part-formula-editor';
import {
  PartTextAnswer,
  type PartEditorRegistration,
} from '../../../../../lib/problem-bank/part-text-answer';

/** 代码小问「运行公开测试」的结果：每个测试过没过。 */
export type PartCodeRun = {
  feedback?: string;
  passed: number;
  total: number;
  cases: Array<{ id: string; passed: boolean; detail?: string }>;
};
export type RunCodePart = (label: string, code: string) => Promise<PartCodeRun | null>;

function caseName(id: string) {
  return id.replace(/^.*\.test_/, '').replace(/_/g, ' ');
}

/** 大题里的代码小问：玻璃编辑器 + 自己试 + 运行公开测试（不算提交）。 */
function PartCode({
  part,
  answer,
  disabled,
  onChange,
  onRun,
}: {
  part: LocalProblemPart;
  answer: LocalPartAnswer;
  disabled: boolean;
  onChange: (next: LocalPartAnswer) => void;
  onRun?: RunCodePart;
}) {
  const content = part.content as unknown as NotebookProblemPublicCode;
  const slots = useMemo(() => codeSlotTemplateFor(content), [content]);
  const code = answer.code ?? defaultCodeAnswerFor(content);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<(PartCodeRun & { code: string }) | null>(null);
  const samples = Array.isArray(content.sampleIO) ? content.sampleIO : [];
  const stale = run && run.code !== code;
  return (
    <div className="pp-code-workspace mp-code-workspace">
      <div className="pp-code-edit-region">
        {slots ? (
          <NativeCodeSlots
            template={slots}
            value={code}
            disabled={disabled}
            className="min-h-0 flex-1 rounded-none border-0 shadow-none"
            onChange={(next) => onChange({ ...answer, code: next })}
          />
        ) : (
          <CodeAnswerEditor
            value={code}
            onChange={(next) => onChange({ ...answer, code: next })}
            disabled={disabled}
            locale="zh-CN"
            placeholder="# 在这里写代码"
            className="min-h-[220px] flex-1"
          />
        )}
      </div>
      <div className="pp-code-test-region">
        <NativeCodePlayground
          code={code}
          files={Array.isArray(content.files) ? (content.files as NotebookCodeFile[]) : []}
          stdin={typeof content.stdin === 'string' ? content.stdin : undefined}
          tests={visibleCodeTests(content)}
          onRunTests={
            content.assumedHelpers?.length && onRun
              ? (candidate) => onRun(part.label, candidate)
              : undefined
          }
          example={samples[0]?.input}
          className="rounded-2xl"
        />
        {onRun ? (
          <div className="space-y-2">
            <button
              type="button"
              disabled={disabled || running}
              onClick={async () => {
                setRunning(true);
                try {
                  const result = await onRun(part.label, code);
                  if (result) setRun({ ...result, code });
                } finally {
                  setRunning(false);
                }
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-sky-200 bg-gradient-to-b from-white to-sky-50 px-3 text-xs font-semibold text-sky-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_3px_rgba(14,165,233,0.2)] transition hover:to-sky-100 disabled:opacity-60"
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FlaskConical className="size-3.5" />
              )}
              运行公开测试
            </button>
            {run ? (
              <div className={stale ? 'space-y-1.5 opacity-60' : 'space-y-1.5'}>
                <p className="text-xs font-medium text-slate-600">
                  {run.total
                    ? `公开测试 ${run.passed}/${run.total} 通过${stale ? '（代码已改动）' : ''}`
                    : run.feedback}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {run.cases.map((item) => (
                    <span
                      key={item.id}
                      className={
                        item.passed
                          ? 'inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-800'
                          : 'inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[11px] text-rose-800'
                      }
                    >
                      <span
                        className={
                          item.passed
                            ? 'size-2 rounded-full bg-emerald-500'
                            : 'size-2 rounded-full bg-rose-500'
                        }
                      />
                      {caseName(item.id)}
                    </span>
                  ))}
                </div>
                {run.cases
                  .filter((item) => !item.passed && item.detail)
                  .slice(0, 2)
                  .map((item) => (
                    <pre
                      key={item.id}
                      className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-mono text-[11px] text-rose-800"
                    >
                      <b>{caseName(item.id)}</b> {item.detail}
                    </pre>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function bareLabel(label: string) {
  return label.replace(/^[(（]|[)）]$/g, '');
}

/** 一颗写着小问编号的珠子；颜色是这一问的状态，没做过是空玻璃。 */
export function PartMarble({
  label,
  result,
  current,
  onClick,
}: {
  label: string;
  result?: LocalPartResult;
  current?: boolean;
  onClick?: () => void;
}) {
  const status = result?.gradedAt || result?.status !== 'pending' ? result?.status : undefined;
  return (
    <button
      type="button"
      className={[
        'sheet-cell',
        'is-sm',
        status ? `is-${status}` : 'is-todo',
        current ? 'is-current' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`小问 ${formatPartLabel(label)}`}
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
    >
      <span className="sheet-cell-orb">
        {status ? <img src={marbleImages[STATUS_MARBLES[status]]} alt="" /> : null}
        <b>{bareLabel(label)}</b>
      </span>
    </button>
  );
}

function PartPrompt({
  part,
  answer,
  onChange,
  disabled,
  locale,
  onEditorReady,
  onEditorFocus,
  result,
  onRunCode,
  showPrompt = true,
  handwritingKey,
  handwritingMode,
  handwritingHeaderId,
}: {
  part: LocalProblemPart;
  result?: LocalPartResult;
  answer: LocalPartAnswer;
  disabled: boolean;
  locale: 'zh-CN' | 'en-US';
  onChange: (next: LocalPartAnswer) => void;
  onRunCode?: RunCodePart;
  showPrompt?: boolean;
  handwritingKey?: string;
  handwritingMode?: boolean;
  handwritingHeaderId?: string;
} & PartEditorRegistration) {
  if (part.type === 'code')
    return (
      <PartCode
        part={part}
        answer={answer}
        disabled={disabled}
        onChange={onChange}
        onRun={onRunCode}
      />
    );
  if (part.type === 'table')
    return (
      <NativeTableAnswer
        content={part.content as NotebookProblemPublicTable}
        values={answer.cells ?? {}}
        results={result?.cells}
        disabled={disabled}
        onChange={(cells) => onChange({ ...answer, cells })}
      />
    );
  if (part.type === 'fill_blank') {
    const ids = partBlankIds(part);
    const numbered = part.prompt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, raw: string) => {
      const index = ids.indexOf(raw.trim());
      return ` **[${index >= 0 ? index + 1 : '?'}] ____** `;
    });
    return (
      <div className="mp-fill">
        {showPrompt ? (
          <ProblemRichText content={numbered} className="text-[15px] leading-7 text-slate-800" />
        ) : null}
        {ids.map((id, index) => (
          <label key={id} className="mp-blank">
            <span>{index + 1}</span>
            <textarea
              rows={Math.max(1, (answer.blanks?.[id] ?? '').split('\n').length)}
              aria-label={`第 ${index + 1} 空`}
              disabled={disabled}
              ref={(editor) =>
                onEditorReady?.(`${part.label}:blank:${id}`, editor, {
                  partLabel: part.label,
                  onInsertText: (text) =>
                    onChange({ ...answer, blanks: { ...(answer.blanks ?? {}), [id]: text } }),
                })
              }
              onFocus={() => onEditorFocus?.(`${part.label}:blank:${id}`)}
              value={answer.blanks?.[id] ?? ''}
              placeholder="填这一空"
              onChange={(event) =>
                onChange({
                  ...answer,
                  blanks: { ...(answer.blanks ?? {}), [id]: event.target.value },
                })
              }
            />
          </label>
        ))}
      </div>
    );
  }
  if (part.type === 'choice') {
    const options = Array.isArray(part.content.options)
      ? (part.content.options as Array<{ id: string; label: string }>)
      : [];
    const multiple = part.content.selectionMode === 'multiple';
    const selected = answer.selectedOptionIds ?? [];
    return (
      <>
        {showPrompt ? (
          <ProblemRichText content={part.prompt} className="text-[15px] leading-7 text-slate-800" />
        ) : null}
        <div className="native-problem-practice-choices">
          {options.map((option) => {
            const on = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={
                  on
                    ? 'native-problem-choice native-problem-choice-selected'
                    : 'native-problem-choice'
                }
                onClick={() =>
                  onChange({
                    ...answer,
                    selectedOptionIds: multiple
                      ? on
                        ? selected.filter((id) => id !== option.id)
                        : [...selected, option.id]
                      : [option.id],
                  })
                }
              >
                <strong>{on ? <img src={marbleImages.blue} alt="" /> : option.id}</strong>
                <span>
                  <ProblemRichText content={option.label} />
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  }
  return (
    <>
      {showPrompt ? (
        <ProblemRichText content={part.prompt} className="text-[15px] leading-7 text-slate-800" />
      ) : null}
      <HandwritingAnswerInput
        draftKey={JSON.stringify([handwritingKey, part.label])}
        handwriting={handwritingMode}
        headerContainerId={handwritingHeaderId}
        disabled={disabled}
        onHandwritingChange={(page) => onChange({ ...answer, images: [], handwriting: page })}
      >
        <PartTextAnswer
          disabled={disabled}
          editorKey={part.label}
          onEditorReady={onEditorReady}
          onEditorFocus={onEditorFocus}
          label={
            locale === 'zh-CN'
              ? `小问 ${formatPartLabel(part.label)} 的解答`
              : `Answer to part ${formatPartLabel(part.label)}`
          }
          className="native-problem-practice-text mp-text"
          rows={part.type === 'calculation' ? 2 : 5}
          value={answer.text ?? ''}
          onChange={(text) => onChange({ ...answer, text })}
          placeholder={part.type === 'calculation' ? '最终结果，公式用 $…$' : '写下这一问的解答'}
        />
      </HandwritingAnswerInput>
      {answer.text && /\$|\\\(|\\\[/.test(answer.text) ? (
        <div className="pp-answer-preview">
          <small>预览</small>
          <ProblemRichText content={answer.text} />
        </div>
      ) : null}
    </>
  );
}

export function PartSubmitButton({
  part,
  answer,
  dirty,
  result,
  submitting,
  onSubmit,
}: {
  part: LocalProblemPart;
  answer: LocalPartAnswer;
  dirty: boolean;
  result?: LocalPartResult;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const exhausted = isAutoGradedPart(part) && (result?.submissions ?? 0) >= PART_SUBMISSION_LIMIT;
  return (
    <button
      type="button"
      className="pp-submit pp-header-submit"
      disabled={submitting || exhausted || !dirty || !partAnswerHasContent(answer)}
      onClick={onSubmit}
    >
      {submitting ? <GlassSpinner size={14} /> : <SendHorizontal size={14} />}
      提交本问
    </button>
  );
}

function PartCard({
  part,
  locale,
  answer,
  result,
  submitting,
  onChange,
  onEditorReady,
  onEditorFocus,
  onRunCode,
  showPrompt,
  handwritingKey,
  handwritingMode,
  handwritingHeaderId,
}: {
  part: LocalProblemPart;
  locale: 'zh-CN' | 'en-US';
  answer: LocalPartAnswer;
  result?: LocalPartResult;
  submitting: boolean;
  onChange: (next: LocalPartAnswer) => void;
  onRunCode?: RunCodePart;
  showPrompt?: boolean;
  handwritingKey?: string;
  handwritingMode?: boolean;
  handwritingHeaderId?: string;
} & PartEditorRegistration) {
  const used = result?.submissions ?? 0;
  const limited = isAutoGradedPart(part);
  const tone = result?.gradedAt ? result.status : 'todo';
  return (
    <article className={`mp-card is-${tone}`} id={`mp-part-${part.label}`}>
      <PartPrompt
        part={part}
        result={result}
        answer={answer}
        onChange={onChange}
        disabled={submitting}
        locale={locale}
        onEditorReady={onEditorReady}
        onEditorFocus={onEditorFocus}
        onRunCode={onRunCode}
        showPrompt={showPrompt}
        handwritingKey={handwritingKey}
        handwritingMode={handwritingMode}
        handwritingHeaderId={handwritingHeaderId}
      />
      {result?.feedback ? (
        <p className={`mp-feedback is-${tone}`}>
          {result.feedback}
          {result.secretSummary ? (
            <small className="mt-1 block opacity-80">
              公开 {result.publicSummary?.passed ?? 0}/{result.publicSummary?.total ?? 0} · 隐藏{' '}
              {result.secretSummary.passed}/{result.secretSummary.total}
            </small>
          ) : null}
        </p>
      ) : null}
      {limited ? (
        <footer>
          <small>
            已交 {used}/{PART_SUBMISSION_LIMIT}
          </small>
        </footer>
      ) : null}
    </article>
  );
}

/**
 * 大题作答区：所有屏幕只显示当前小问，窄屏还支持左右滑动。
 */
export function MultipartPractice({
  parts,
  locale = 'zh-CN',
  handwritingKey,
  handwritingMode,
  handwritingHeaderId,
  formulaRef,
  navigationTarget,
  activePartLabel,
  onSelectPart,
  drafts,
  saved,
  results,
  paged,
  submitting,
  error,
  onChange,
  onSubmit,
  onRunCode,
}: {
  parts: LocalProblemPart[];
  locale?: 'zh-CN' | 'en-US';
  handwritingKey?: string;
  handwritingMode?: boolean;
  handwritingHeaderId?: string;
  formulaRef?: Ref<PartFormulaHandle>;
  navigationTarget?: HTMLElement | null;
  activePartLabel?: string;
  onSelectPart?: (label: string) => void;
  drafts: Record<string, LocalPartAnswer>;
  /** 上一次交过的作答，打开题目时先显示它 */
  saved: Record<string, LocalPartAnswer>;
  results: LocalPartResult[];
  paged: boolean;
  submitting: boolean;
  error: string | null;
  onChange: (label: string, next: LocalPartAnswer) => void;
  onSubmit: (labels: string[]) => void;
  onRunCode?: RunCodePart;
}) {
  const resultOf = (label: string) => results.find((item) => item.label === label);
  // 默认停在第一道还没答对的小问。
  const firstOpen = Math.max(
    0,
    parts.findIndex((part) => resultOf(part.label)?.status !== 'passed'),
  );
  const [requestedPage, setPage] = useState(firstOpen);
  const selectedIndex = activePartLabel
    ? parts.findIndex((part) => part.label === activePartLabel)
    : requestedPage;
  const page = Math.min(Math.max(0, selectedIndex), Math.max(0, parts.length - 1));
  const selectPage = (index: number) => {
    const next = Math.max(0, Math.min(parts.length - 1, index));
    setPage(next);
    if (parts[next]) onSelectPart?.(parts[next].label);
  };
  const touchX = useRef<number | null>(null);
  const formulaEditor = usePartFormulaEditor({
    disabled: submitting,
    visiblePartLabel: parts[page]?.label,
    onInsertText: (label, text) =>
      onChange(label, {
        ...(drafts[label] ?? saved[label] ?? {}),
        images: [],
        text,
      }),
  });
  useImperativeHandle(formulaRef, () => ({ insertFormula: formulaEditor.insertFormula }), [
    formulaEditor.insertFormula,
  ]);
  const isDirty = (label: string) => partDraftIsDirty(drafts[label], saved[label]);
  const dirty = parts.filter((part) => isDirty(part.label)).map((part) => part.label);

  const strip = (
    <div className="mp-strip" role="tablist" aria-label="小问">
      {parts.map((part, index) => (
        <PartMarble
          key={part.label}
          label={part.label}
          result={resultOf(part.label)}
          current={index === page}
          onClick={() => selectPage(index)}
        />
      ))}
    </div>
  );

  const card = (part: LocalProblemPart) => (
    <PartCard
      key={part.label}
      part={part}
      locale={locale}
      onEditorReady={formulaEditor.registerEditor}
      onEditorFocus={formulaEditor.activateEditor}
      answer={{ ...(drafts[part.label] ?? saved[part.label] ?? {}), images: [] }}
      result={resultOf(part.label)}
      submitting={submitting}
      onChange={(next) => onChange(part.label, next)}
      onRunCode={onRunCode}
      showPrompt={!navigationTarget}
      handwritingKey={handwritingKey}
      handwritingMode={handwritingMode}
      handwritingHeaderId={handwritingHeaderId}
    />
  );

  return (
    <div className="mp-root mp-single-part">
      {navigationTarget ? createPortal(strip, navigationTarget) : strip}
      <div
        className="mp-pager"
        onTouchStart={(event) => {
          touchX.current = (event.target as HTMLElement).closest('textarea,input,button,dialog')
            ? null
            : (event.touches[0]?.clientX ?? null);
        }}
        onTouchEnd={(event) => {
          const start = touchX.current;
          touchX.current = null;
          const end = event.changedTouches[0]?.clientX;
          if (start === null || end === undefined || Math.abs(end - start) < 48) return;
          if (paged) selectPage(page + (end < start ? 1 : -1));
        }}
      >
        <div key={parts[page]?.label} className="mp-page">
          {parts[page] ? card(parts[page]) : null}
        </div>
        {paged ? (
          <nav className="mp-pager-nav">
            <button
              type="button"
              className="phone-glass-button"
              disabled={page <= 0}
              onClick={() => selectPage(page - 1)}
              aria-label="上一问"
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {formatPartLabel(parts[page]?.label ?? '')} · {page + 1}/{parts.length}
            </span>
            <button
              type="button"
              className="phone-glass-button"
              disabled={page >= parts.length - 1}
              onClick={() => selectPage(page + 1)}
              aria-label="下一问"
            >
              <ChevronRight size={18} />
            </button>
          </nav>
        ) : null}
      </div>
      {dirty.length > 1 ? (
        <button
          type="button"
          className="pp-submit mp-submit-all"
          disabled={submitting}
          onClick={() => onSubmit(dirty)}
        >
          {submitting ? <GlassSpinner size={15} /> : <SendHorizontal size={15} />}
          一起提交 {dirty.map(formatPartLabel).join('')}
        </button>
      ) : null}
      {error ? <p className="native-problem-practice-error">{error}</p> : null}
    </div>
  );
}
