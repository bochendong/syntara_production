'use client';

import { useId, useRef, useState } from 'react';
import { MATH_SYMBOL_GROUPS } from '../../components/problem-bank/math-symbol-groups';
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
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  locale: 'zh-CN' | 'en-US';
  label: string;
  rows: number;
  placeholder: string;
  className?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const zh = locale === 'zh-CN';
  const insertSymbol = (symbol: string) => {
    if (disabled) return;
    const editor = input.current;
    const start = editor?.selectionStart ?? value.length;
    const end = editor?.selectionEnd ?? start;
    const scrollTop = editor?.scrollTop ?? 0;
    onChange(value.slice(0, start) + symbol + value.slice(end));
    requestAnimationFrame(() => {
      const target = input.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.setSelectionRange(start + symbol.length, start + symbol.length);
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
          <span aria-hidden="true">∑</span> {zh ? '符号表' : 'Symbol palette'}
        </button>
      </div>
      {expanded ? (
        <section
          id={panelId}
          className="part-symbol-panel"
          aria-label={zh ? '符号表' : 'Symbol palette'}
        >
          {MATH_SYMBOL_GROUPS.map((group) => (
            <div key={group.zh} className="part-symbol-group">
              <p>{zh ? group.zh : group.en}</p>
              <div>
                {group.symbols.map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    title={symbol}
                    aria-label={symbol}
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertSymbol(symbol)}
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </div>
          ))}
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
