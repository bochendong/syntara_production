'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProblemRichText } from './problem-rich-text';
import type { NotebookProblemPublicFillBlank } from '@/lib/problem-bank';

/** Parse the whole document once; insert controls into text nodes after parsing. */
export function InteractiveFillBlank({
  content,
  values,
  disabled,
  locale,
  onFocusBlank,
  onChangeBlank,
}: {
  content: NotebookProblemPublicFillBlank;
  values: Record<string, string>;
  disabled: boolean;
  locale: 'zh-CN' | 'en-US';
  onFocusBlank: (id: string) => void;
  onChangeBlank: (id: string, value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ node: HTMLElement; id: string; code: boolean }[]>([]);
  const template = useMemo(() => {
    const ids: string[] = [];
    const text = content.stemTemplate.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, id: string) => {
      ids.push(id.trim());
      return `SYNTARABLANKTOKEN${ids.length - 1}END`;
    });
    return { text, ids };
  }, [content.stemTemplate]);
  useLayoutEffect(() => {
    if (!root.current) return;
    const walker = document.createTreeWalker(root.current, NodeFilter.SHOW_TEXT);
    const matches: Text[] = [];
    while (walker.nextNode()) {
      if (/SYNTARABLANKTOKEN\d+END/.test(walker.currentNode.textContent || ''))
        matches.push(walker.currentNode as Text);
    }
    if (!matches.length && template.ids.length) return;
    const next: typeof slots = [];
    for (const textNode of matches) {
      const fragment = document.createDocumentFragment();
      const text = textNode.textContent || '';
      let cursor = 0;
      for (const match of text.matchAll(/SYNTARABLANKTOKEN(\d+)END/g)) {
        fragment.append(text.slice(cursor, match.index));
        const node = document.createElement('span');
        const id = template.ids[Number(match[1])];
        const code = Boolean(textNode.parentElement?.closest('pre, code'));
        node.dataset.blankId = id;
        fragment.append(node);
        next.push({ node, id, code });
        cursor = match.index! + match[0].length;
      }
      fragment.append(text.slice(cursor));
      textNode.replaceWith(fragment);
    }
    // Portal targets depend on the committed Markdown DOM, so mount them before paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlots(next);
  }, [template]);
  return (
    <div ref={root}>
      <ProblemRichText
        key={content.stemTemplate}
        content={template.text}
        className="text-[15px] [&_pre]:leading-9"
      />
      {slots.map(({ node, id, code }, index) => {
        const blankIndex = content.blanks.findIndex((blank) => blank.id === id);
        const blank = content.blanks[blankIndex];
        if (!blank) return null;
        const label =
          blank.placeholder ||
          (locale === 'zh-CN' ? `第 ${blankIndex + 1} 空` : `Blank ${blankIndex + 1}`);
        const value = values[id] || '';
        const isCode = code || blank.answerKind === 'code_token';
        return createPortal(
          <textarea
            rows={Math.max(1, value.split('\n').length)}
            aria-label={label}
            title={label}
            value={value}
            disabled={disabled}
            placeholder={locale === 'zh-CN' ? `空 ${blankIndex + 1}` : `Blank ${blankIndex + 1}`}
            spellCheck={!isCode}
            autoComplete="off"
            onFocus={() => onFocusBlank(id)}
            onKeyDown={(event) => {
              if (isCode && event.key === 'Tab' && !event.shiftKey) {
                event.preventDefault();
                const field = event.currentTarget;
                const start = field.selectionStart;
                onChangeBlank(id, `${value.slice(0, start)}    ${value.slice(field.selectionEnd)}`);
                requestAnimationFrame(() => field.setSelectionRange(start + 4, start + 4));
              }
            }}
            onChange={(event) => onChangeBlank(id, event.target.value)}
            style={{
              width: `${Math.min(60, Math.max(10, Math.max(...value.split('\n').map((line) => line.length)) + 2))}ch`,
            }}
            className="mx-1 inline-block min-h-8 resize-none max-w-full rounded-md border border-sky-200 bg-sky-50 px-2 align-middle font-mono text-sm text-slate-900 outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-60 dark:border-sky-500/30 dark:bg-slate-900 dark:text-white"
          />,
          node,
          `${id}-${index}`,
        );
      })}
    </div>
  );
}
