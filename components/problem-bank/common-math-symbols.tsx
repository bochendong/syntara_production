'use client';

import { renderToString } from 'katex';

const COMMON_MATH_SYMBOLS = [
  ['∈', '\\in'],
  ['∉', '\\notin'],
  ['⊂', '\\subset'],
  ['⊆', '\\subseteq'],
  ['⊄', '\\not\\subset'],
  ['∪', '\\cup'],
  ['∩', '\\cap'],
  ['∅', '\\varnothing'],
  ['∀', '\\forall'],
  ['∃', '\\exists'],
  ['⇒', '\\Rightarrow'],
  ['⇔', '\\Leftrightarrow'],
  ['≠', '\\ne'],
  ['≤', '\\le'],
  ['≥', '\\ge'],
  ['≈', '\\approx'],
  ['∞', '\\infty'],
  ['∑', '\\sum'],
  ['√', '\\surd'],
  ['π', '\\pi'],
].map(([symbol, latex]) => ({
  symbol,
  html: renderToString(latex, { throwOnError: false, output: 'html', displayMode: false }),
}));

export function CommonMathSymbols({
  onInsert,
}: {
  locale: 'zh-CN' | 'en-US';
  onInsert: (symbol: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="flex flex-wrap gap-2">
        {COMMON_MATH_SYMBOLS.map(({ symbol, html }) => (
          <button
            key={symbol}
            type="button"
            aria-label={symbol}
            title={symbol}
            onClick={() => onInsert(symbol)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-sky-300 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-700 dark:hover:text-sky-200"
          >
            <span
              aria-hidden="true"
              className="inline-flex min-w-3 items-center justify-center text-base leading-none [&_.katex]:text-[1em]"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
