import { memo, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ListOrdered, Play } from 'lucide-react';
import { highlightCodeLines } from './code-highlight';

export interface TraceStep {
  state: string;
  note: string;
}

/** 每行 `式子、代码行或状态 | 一句说明`；按最后一个 “ | ” 切开，代码里偶尔的 | 不受影响。 */
export function parseTraceLines(lines: string[]): TraceStep[] {
  return lines
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trimEnd())
    .filter((line) => line.trim())
    .map((line) => {
      const cut = line.lastIndexOf(' | ');
      if (cut < 0) return { state: line.trim(), note: '' };
      return { state: line.slice(0, cut).trim(), note: line.slice(cut + 3).trim() };
    });
}

type TraceKind = 'racket' | 'python' | 'math';

/** 大多数步骤以 ( 开头就是 Racket 代换；写成 $...$ 的是数学推导；其余按 Python 状态显示。 */
function traceKind(steps: TraceStep[]): TraceKind {
  if (steps.some((step) => /^\$.*\$$/.test(step.state))) return 'math';
  const lisp = steps.filter((step) => step.state.startsWith('(')).length;
  return lisp * 2 >= steps.length ? 'racket' : 'python';
}

function CodeState({ text, kind }: { text: string; kind: Exclude<TraceKind, 'math'> }) {
  const lines = useMemo(() => highlightCodeLines(text, kind), [text, kind]);
  return (
    <pre className="chat-trace-code">
      <code>
        {lines.map((tokens, index) => (
          <span key={index} className="chat-code-line">
            {tokens.map((token, tokenIndex) =>
              token.kind === 'plain' ? (
                token.text
              ) : (
                <span key={tokenIndex} className={`tk-${token.kind}`}>
                  {token.text}
                </span>
              ),
            )}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  );
}

/**
 * 逐步演示（```trace）：像 DrRacket Stepper / Python Tutor 那样一步步点着看。
 */
export const ChatTrace = memo(function ChatTrace({
  title,
  lines,
  renderNote,
}: {
  title: string;
  lines: string[];
  /** 说明和数学式子交给外面的 Markdown 渲染（带公式和引用胶囊）。 */
  renderNote: (text: string) => ReactNode;
}) {
  const steps = useMemo(() => parseTraceLines(lines), [lines]);
  const kind = useMemo(() => traceKind(steps), [steps]);
  // 从第一步开始看；流式输出时后面的步骤陆续出现在进度点里。
  const [picked, setPicked] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const last = Math.max(steps.length - 1, 0);

  if (!steps.length) return null;
  const current = Math.min(picked, last);
  const step = steps[current];
  const go = (next: number) => setPicked(Math.max(0, Math.min(last, next)));
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight') go(current + 1);
    else if (event.key === 'ArrowLeft') go(current - 1);
    else return;
    event.preventDefault();
  };
  const state = (text: string) =>
    kind === 'math' ? (
      <div className="chat-trace-math">{renderNote(text)}</div>
    ) : (
      <CodeState text={text} kind={kind} />
    );

  return (
    <figure
      className="chat-trace"
      data-kind={kind}
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={`逐步演示：${title || '执行过程'}`}
    >
      <header className="chat-trace-bar">
        <span className="chat-trace-badge" aria-hidden>
          <Play size={11} strokeWidth={2.6} fill="currentColor" />
        </span>
        <span className="chat-trace-title">{title || '一步步看'}</span>
        <button
          type="button"
          className={`chat-trace-all${showAll ? ' is-on' : ''}`}
          onClick={() => setShowAll((value) => !value)}
          aria-pressed={showAll}
          aria-label={showAll ? '一步一步看' : '看全部步骤'}
        >
          <ListOrdered size={14} strokeWidth={2.2} />
        </button>
      </header>

      {showAll ? (
        <ol className="chat-trace-list">
          {steps.map((item, itemIndex) => (
            <li key={itemIndex} className={itemIndex === current ? 'is-current' : undefined}>
              <button type="button" className="chat-trace-num" onClick={() => go(itemIndex)}>
                {itemIndex + 1}
              </button>
              <div>
                {state(item.state)}
                {item.note ? <div className="chat-trace-note">{renderNote(item.note)}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="chat-trace-stage" aria-live="polite">
          {current > 0 ? (
            <div className="chat-trace-prev" aria-hidden>
              {state(steps[current - 1].state)}
            </div>
          ) : null}
          <div className="chat-trace-now" key={current}>
            {state(step.state)}
          </div>
          {step.note ? <div className="chat-trace-note">{renderNote(step.note)}</div> : null}
        </div>
      )}

      <footer className="chat-trace-foot">
        <button
          type="button"
          className="chat-trace-step"
          onClick={() => go(current - 1)}
          disabled={current === 0}
          aria-label="上一步"
        >
          <ChevronLeft size={16} strokeWidth={2.4} />
        </button>
        <div className="chat-trace-dots" role="tablist">
          {steps.map((_, dot) => (
            <button
              key={dot}
              type="button"
              role="tab"
              aria-selected={dot === current}
              aria-label={`第 ${dot + 1} 步`}
              className={dot === current ? 'is-current' : dot < current ? 'is-done' : undefined}
              onClick={() => go(dot)}
            />
          ))}
        </div>
        <span className="chat-trace-count">
          {current + 1} / {steps.length}
        </span>
        <button
          type="button"
          className="chat-trace-step is-next"
          onClick={() => go(current + 1)}
          disabled={current === last}
          aria-label="下一步"
        >
          <ChevronRight size={16} strokeWidth={2.4} />
        </button>
      </footer>
    </figure>
  );
});
