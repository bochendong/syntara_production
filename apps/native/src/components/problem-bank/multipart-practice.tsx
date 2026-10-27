import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CornerDownRight, SendHorizontal } from 'lucide-react';

import {
  formatPartLabel,
  isAutoGradedPart,
  partAnswerHasContent,
  partBlankIds,
  partShares,
  PART_SUBMISSION_LIMIT,
  type LocalPartAnswer,
  type LocalPartResult,
  type LocalProblemPart,
} from '../../data/multipart-problem';
import { marbleImages } from '../../lib/learning-action-marbles';
import { GlassSpinner } from '../GlassLoadMore';
import { STATUS_MARBLES } from './answer-sheet';
import { ProblemRichText } from './problem-rich-text';
import { PartTextAnswer } from '../../../../../lib/problem-bank/part-text-answer';

const PART_TYPE_LABELS: Record<LocalProblemPart['type'], string> = {
  choice: '选择',
  fill_blank: '填空',
  calculation: '计算',
  short_answer: '简答',
  proof: '证明',
};

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
}: {
  part: LocalProblemPart;
  answer: LocalPartAnswer;
  disabled: boolean;
  locale: 'zh-CN' | 'en-US';
  onChange: (next: LocalPartAnswer) => void;
}) {
  if (part.type === 'fill_blank') {
    const ids = partBlankIds(part);
    const numbered = part.prompt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, raw: string) => {
      const index = ids.indexOf(raw.trim());
      return ` **[${index >= 0 ? index + 1 : '?'}] ____** `;
    });
    return (
      <div className="mp-fill">
        <ProblemRichText content={numbered} className="text-[15px] leading-7 text-slate-800" />
        {ids.map((id, index) => (
          <label key={id} className="mp-blank">
            <span>{index + 1}</span>
            <input
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
        <ProblemRichText content={part.prompt} className="text-[15px] leading-7 text-slate-800" />
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
      <ProblemRichText content={part.prompt} className="text-[15px] leading-7 text-slate-800" />
      <PartTextAnswer
        disabled={disabled}
        locale={locale}
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
      {answer.text && /\$|\\\(|\\\[/.test(answer.text) ? (
        <div className="pp-answer-preview">
          <small>预览</small>
          <ProblemRichText content={answer.text} />
        </div>
      ) : null}
    </>
  );
}

function PartCard({
  part,
  share,
  locale,
  answer,
  dirty,
  result,
  submitting,
  onChange,
  onSubmit,
}: {
  part: LocalProblemPart;
  share: number;
  locale: 'zh-CN' | 'en-US';
  answer: LocalPartAnswer;
  /** 和上次交的不一样，才能再交 */
  dirty: boolean;
  result?: LocalPartResult;
  submitting: boolean;
  onChange: (next: LocalPartAnswer) => void;
  onSubmit: () => void;
}) {
  const used = result?.submissions ?? 0;
  const limited = isAutoGradedPart(part);
  const exhausted = limited && used >= PART_SUBMISSION_LIMIT;
  const tone = result?.gradedAt ? result.status : 'todo';
  return (
    <article className={`mp-card is-${tone}`} id={`mp-part-${part.label}`}>
      <header>
        <PartMarble label={part.label} result={result} />
        <span>
          {PART_TYPE_LABELS[part.type]} · {Math.round(share * 100)} 分
        </span>
        {part.dependsOn.length ? (
          <small className="mp-depends">
            <CornerDownRight size={11} />
            接着 {part.dependsOn.map(formatPartLabel).join('')}
          </small>
        ) : null}
        {result?.gradedAt ? (
          <b className="mp-score">{Math.round(result.score * share * 100)}</b>
        ) : null}
      </header>
      <PartPrompt
        part={part}
        answer={answer}
        onChange={onChange}
        disabled={submitting}
        locale={locale}
      />
      {result?.feedback ? <p className={`mp-feedback is-${tone}`}>{result.feedback}</p> : null}
      <footer>
        {limited ? (
          <small>
            已交 {used}/{PART_SUBMISSION_LIMIT}
          </small>
        ) : null}
        <button
          type="button"
          className="pp-submit mp-submit"
          disabled={submitting || exhausted || !dirty || !partAnswerHasContent(answer)}
          onClick={onSubmit}
        >
          {submitting ? <GlassSpinner size={14} /> : <SendHorizontal size={14} />}
          提交这一问
        </button>
      </footer>
    </article>
  );
}

/**
 * 大题作答区。宽屏把所有小问竖着排成卡片；窄屏（手机）一问一页，左右滑或点珠子切换。
 */
export function MultipartPractice({
  parts,
  locale = 'zh-CN',
  drafts,
  saved,
  results,
  paged,
  submitting,
  error,
  onChange,
  onSubmit,
}: {
  parts: LocalProblemPart[];
  locale?: 'zh-CN' | 'en-US';
  drafts: Record<string, LocalPartAnswer>;
  /** 上一次交过的作答，打开题目时先显示它 */
  saved: Record<string, LocalPartAnswer>;
  results: LocalPartResult[];
  paged: boolean;
  submitting: boolean;
  error: string | null;
  onChange: (label: string, next: LocalPartAnswer) => void;
  onSubmit: (labels: string[]) => void;
}) {
  const shares = partShares(parts);
  const resultOf = (label: string) => results.find((item) => item.label === label);
  // 窄屏默认停在第一道还没答对的小问
  const firstOpen = Math.max(
    0,
    parts.findIndex((part) => resultOf(part.label)?.status !== 'passed'),
  );
  const [requestedPage, setPage] = useState(firstOpen);
  const page = Math.min(requestedPage, Math.max(0, parts.length - 1));
  const touchX = useRef<number | null>(null);
  const isDirty = (label: string) =>
    label in drafts &&
    partAnswerHasContent(drafts[label]) &&
    JSON.stringify(drafts[label]) !== JSON.stringify(saved[label] ?? {});
  const dirty = parts.filter((part) => isDirty(part.label)).map((part) => part.label);
  const passed = parts.filter((part) => resultOf(part.label)?.status === 'passed').length;

  const strip = (
    <div className="mp-strip" role="tablist" aria-label="小问">
      {parts.map((part, index) => (
        <PartMarble
          key={part.label}
          label={part.label}
          result={resultOf(part.label)}
          current={paged && index === page}
          onClick={() => {
            if (paged) setPage(index);
            else
              document
                .getElementById(`mp-part-${part.label}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      ))}
      <small>
        {passed}/{parts.length} 问答对
      </small>
    </div>
  );

  const card = (part: LocalProblemPart, index: number) => (
    <PartCard
      key={part.label}
      part={part}
      share={shares[index]}
      locale={locale}
      answer={drafts[part.label] ?? saved[part.label] ?? {}}
      dirty={isDirty(part.label)}
      result={resultOf(part.label)}
      submitting={submitting}
      onChange={(next) => onChange(part.label, next)}
      onSubmit={() => onSubmit([part.label])}
    />
  );

  return (
    <div className="mp-root">
      {strip}
      {paged ? (
        <div
          className="mp-pager"
          onTouchStart={(event) => {
            touchX.current = event.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(event) => {
            const start = touchX.current;
            touchX.current = null;
            const end = event.changedTouches[0]?.clientX;
            if (start === null || end === undefined || Math.abs(end - start) < 48) return;
            setPage((current) =>
              Math.max(0, Math.min(parts.length - 1, current + (end < start ? 1 : -1))),
            );
          }}
        >
          <div key={parts[page]?.label} className="mp-page">
            {parts[page] ? card(parts[page], page) : null}
          </div>
          <nav className="mp-pager-nav">
            <button
              type="button"
              className="phone-glass-button"
              disabled={page <= 0}
              onClick={() => setPage(page - 1)}
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
              onClick={() => setPage(page + 1)}
              aria-label="下一问"
            >
              <ChevronRight size={18} />
            </button>
          </nav>
        </div>
      ) : (
        parts.map(card)
      )}
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
