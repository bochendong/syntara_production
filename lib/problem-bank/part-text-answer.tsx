'use client';

import { useId, useRef, useState, type ComponentType } from 'react';
import './part-text-answer.css';

/** Each part owns its editor and insertion target, including when several cards are visible. */
export function PartTextAnswer({
  value,
  onChange,
  disabled = false,
  locale,
  label,
  rows,
  placeholder,
  className,
  FormulaReference,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  locale: 'zh-CN' | 'en-US';
  label: string;
  rows: number;
  placeholder: string;
  className?: string;
  FormulaReference: ComponentType<{
    locale: 'zh-CN' | 'en-US';
    onInsert: (latex: string) => void;
    insertionHint?: string;
  }>;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const zh = locale === 'zh-CN';
  const insertFormula = (latex: string) => {
    if (disabled) return;
    const editor = input.current;
    const start = editor?.selectionStart ?? value.length;
    const end = editor?.selectionEnd ?? start;
    const scrollTop = editor?.scrollTop ?? 0;
    onChange(value.slice(0, start) + latex + value.slice(end));
    requestAnimationFrame(() => {
      const target = input.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.setSelectionRange(start + latex.length, start + latex.length);
      target.scrollTop = scrollTop;
    });
  };

  return (
    <div className="part-text-answer">
      <div className="part-text-answer-toolbar">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={expanded}
          aria-controls={panelId}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setExpanded((current) => !current)}
        >
          <span aria-hidden="true">∑</span> {zh ? '公式表' : 'Formula table'}
        </button>
      </div>
      {expanded ? (
        <section
          id={panelId}
          className="part-formula-reference"
          aria-label={zh ? '公式表' : 'Formula table'}
        >
          <fieldset disabled={disabled}>
            <FormulaReference
              locale={locale}
              onInsert={insertFormula}
              insertionHint={
                zh
                  ? '点击「插入」将公式放到当前小问答案的光标位置。'
                  : 'Insert a formula at the cursor in this part’s answer.'
              }
            />
          </fieldset>
        </section>
      ) : null}
      <textarea
        ref={input}
        aria-label={label}
        value={value}
        disabled={disabled}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={className}
      />
    </div>
  );
}
