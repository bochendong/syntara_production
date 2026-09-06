'use client';

import { renderToString } from 'katex';
import { MATH_SYMBOL_GROUPS } from './math-symbol-groups';

const symbolGroups = MATH_SYMBOL_GROUPS.map((group) => ({
  ...group,
  symbols: group.symbols.map((symbol) => ({
    symbol,
    html: renderToString(symbol === '∉' ? '\\notin' : symbol === '√' ? '\\surd' : symbol, {
      throwOnError: false,
      strict: false,
      output: 'html',
    }),
  })),
}));

export function MathSymbolPanel({
  locale,
  onInsert,
  disabled = false,
}: {
  locale: 'zh-CN' | 'en-US';
  onInsert: (symbol: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      {symbolGroups.map((group) => (
        <div key={group.zh} className="space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {locale === 'zh-CN' ? group.zh : group.en}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.symbols.map(({ symbol, html }) => (
              <button
                key={symbol}
                type="button"
                aria-label={symbol}
                title={symbol}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInsert(symbol)}
                className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 text-slate-700 hover:border-sky-300 hover:bg-sky-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
