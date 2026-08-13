'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Bold,
  Braces,
  Code2,
  Eye,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  SquareFunction,
} from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { renderMathToHtml } from '@/lib/math-engine';
import { cn } from '@/lib/utils';

const SYMBOL_GROUPS = [
  {
    label: '集合与数系',
    symbols: [
      ['\\mathbb{N}', '自然数'],
      ['\\mathbb{Z}', '整数'],
      ['\\mathbb{Q}', '有理数'],
      ['\\mathbb{R}', '实数'],
      ['\\mathbb{C}', '复数'],
      ['\\varnothing', '空集'],
      ['\\in', '属于'],
      ['\\notin', '不属于'],
      ['\\subset', '真子集'],
      ['\\subseteq', '子集'],
      ['\\supseteq', '超集'],
      ['\\cup', '并集'],
      ['\\cap', '交集'],
      ['\\setminus', '差集'],
    ],
  },
  {
    label: '逻辑与证明',
    symbols: [
      ['\\forall', '任意'],
      ['\\exists', '存在'],
      ['\\nexists', '不存在'],
      ['\\therefore', '所以'],
      ['\\because', '因为'],
      ['\\neg', '非'],
      ['\\land', '且'],
      ['\\lor', '或'],
      ['\\vdash', '可推导'],
      ['\\models', '满足'],
      ['\\Rightarrow', '推出'],
      ['\\Leftarrow', '由此得'],
      ['\\Leftrightarrow', '等价'],
    ],
  },
  {
    label: '关系与运算',
    symbols: [
      ['=', '等于'],
      ['\\neq', '不等于'],
      ['\\leq', '小于等于'],
      ['\\geq', '大于等于'],
      ['\\approx', '约等于'],
      ['\\equiv', '恒等'],
      ['\\propto', '正比'],
      ['\\pm', '正负'],
      ['\\times', '乘'],
      ['\\div', '除'],
      ['\\cdot', '点乘'],
      ['\\sum', '求和'],
      ['\\prod', '求积'],
      ['\\sqrt{x}', '根式'],
      ['\\infty', '无穷'],
      ['\\partial', '偏导'],
      ['\\nabla', '梯度'],
      ['\\int', '积分'],
    ],
  },
  {
    label: '箭头',
    symbols: [
      ['\\to', '趋向'],
      ['\\leftarrow', '左箭头'],
      ['\\leftrightarrow', '双向'],
      ['\\mapsto', '映射'],
      ['\\uparrow', '向上'],
      ['\\downarrow', '向下'],
      ['\\nearrow', '右上'],
      ['\\searrow', '右下'],
      ['\\longrightarrow', '长右箭头'],
      ['\\longleftarrow', '长左箭头'],
      ['\\longleftrightarrow', '长双向箭头'],
    ],
  },
  {
    label: '希腊字母',
    symbols: [
      ['\\alpha', 'alpha'],
      ['\\beta', 'beta'],
      ['\\gamma', 'gamma'],
      ['\\delta', 'delta'],
      ['\\epsilon', 'epsilon'],
      ['\\theta', 'theta'],
      ['\\lambda', 'lambda'],
      ['\\mu', 'mu'],
      ['\\pi', 'pi'],
      ['\\rho', 'rho'],
      ['\\sigma', 'sigma'],
      ['\\phi', 'phi'],
      ['\\omega', 'omega'],
      ['\\Gamma', 'Gamma'],
      ['\\Delta', 'Delta'],
      ['\\Theta', 'Theta'],
      ['\\Lambda', 'Lambda'],
      ['\\Sigma', 'Sigma'],
      ['\\Phi', 'Phi'],
      ['\\Omega', 'Omega'],
    ],
  },
  {
    label: '几何',
    symbols: [
      ['\\angle', '角'],
      ['\\perp', '垂直'],
      ['\\parallel', '平行'],
      ['\\triangle', '三角形'],
      ['\\square', '正方形'],
      ['\\circ', '圆'],
      ['\\frown', '圆弧'],
      ['^\\circ', '度'],
      ["'", '一撇'],
      ["''", '两撇'],
    ],
  },
] as const;

const FORMULA_EXAMPLES = [
  { label: '分数', latex: '\\frac{a+b}{c}' },
  { label: '平方', latex: 'x^2+y^2=z^2' },
  { label: '根式', latex: '\\sqrt{x^2+y^2}' },
  { label: '定积分', latex: '\\int_{0}^{1} f(x)\\,dx' },
  { label: '求和', latex: '\\sum_{i=1}^{n} a_i' },
  { label: '极限', latex: '\\lim_{x\\to 0} \\frac{\\sin x}{x}=1' },
] as const;

const ADVANCED_STRUCTURES = [
  {
    label: 'Markdown 表格',
    kind: 'markdown' as const,
    source: '| 项目 | 数值 |\n| --- | ---: |\n| A | 1 |\n| B | 2 |',
  },
  {
    label: '2 × 2 矩阵',
    kind: 'math' as const,
    source: '\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}',
  },
  {
    label: '3 × 3 矩阵',
    kind: 'math' as const,
    source: '\\begin{bmatrix}a&b&c\\\\d&e&f\\\\g&h&i\\end{bmatrix}',
  },
  {
    label: '分段函数',
    kind: 'math' as const,
    source: 'f(x)=\\begin{cases}x^2,&x\\geq 0\\\\-x,&x<0\\end{cases}',
  },
  {
    label: '方程组',
    kind: 'math' as const,
    source: '\\begin{cases}2x+y=5\\\\x-y=1\\end{cases}',
  },
  {
    label: '行列式',
    kind: 'math' as const,
    source: '\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}=ad-bc',
  },
  {
    label: '多行推导',
    kind: 'math' as const,
    source: '\\begin{aligned}a&=b+c\\\\&=d+e\\\\&=f\\end{aligned}',
  },
] as const;

type EditorMode = 'markdown' | 'preview';
type ToolPanel = 'symbols' | 'formula' | 'structures';
type FormatAction =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'quote'
  | 'bullet-list'
  | 'ordered-list'
  | 'code'
  | 'link';

const FORMAT_CONTROLS = [
  { label: '标题', icon: Heading2, action: 'heading' },
  { label: '加粗', icon: Bold, action: 'bold' },
  { label: '斜体', icon: Italic, action: 'italic' },
  { label: '引用', icon: Quote, action: 'quote' },
  { label: '无序列表', icon: List, action: 'bullet-list' },
  { label: '有序列表', icon: ListOrdered, action: 'ordered-list' },
  { label: '行内代码', icon: Code2, action: 'code' },
  { label: '链接', icon: Link, action: 'link' },
] as const satisfies ReadonlyArray<{
  label: string;
  icon: typeof Heading2;
  action: FormatAction;
}>;

type ForumMarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export function ForumMarkdownEditor({
  value,
  onChange,
  placeholder = '输入正文，支持 Markdown、代码块和 LaTeX 公式…',
  className,
}: ForumMarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>('markdown');
  const [toolPanel, setToolPanel] = useState<ToolPanel>('symbols');

  const insertAtSelection = useCallback(
    (before: string, after = '', fallback = '') => {
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? value.length;
      const end = textarea?.selectionEnd ?? value.length;
      const selected = value.slice(start, end);
      const content = selected || fallback;
      const next = `${value.slice(0, start)}${before}${content}${after}${value.slice(end)}`;
      const selectionStart = start + before.length;
      const selectionEnd = selectionStart + content.length;

      onChange(next);
      setMode('markdown');
      requestAnimationFrame(() => {
        const nextTextarea = textareaRef.current;
        nextTextarea?.focus();
        nextTextarea?.setSelectionRange(selectionStart, selectionEnd);
      });
    },
    [onChange, value],
  );

  const insertBlock = useCallback(
    (prefix: string, fallback: string) => {
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? value.length;
      const needsLeadingLineBreak = start > 0 && value[start - 1] !== '\n';
      insertAtSelection(`${needsLeadingLineBreak ? '\n' : ''}${prefix}`, '', fallback);
    },
    [insertAtSelection, value],
  );

  const insertStructure = useCallback(
    (structure: (typeof ADVANCED_STRUCTURES)[number]) => {
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? value.length;
      const end = textarea?.selectionEnd ?? value.length;
      const needsLeadingLineBreak = start > 0 && value[start - 1] !== '\n';
      const needsTrailingLineBreak = end < value.length && value[end] !== '\n';
      const leading = needsLeadingLineBreak ? '\n' : '';
      const trailing = needsTrailingLineBreak ? '\n' : '';

      if (structure.kind === 'math') {
        insertAtSelection(`${leading}$$\n`, `\n$$${trailing}`, structure.source);
        return;
      }
      insertAtSelection(leading, trailing, structure.source);
    },
    [insertAtSelection, value],
  );

  const applyFormat = (action: FormatAction) => {
    switch (action) {
      case 'heading':
        insertBlock('## ', '小标题');
        break;
      case 'bold':
        insertAtSelection('**', '**', '重点内容');
        break;
      case 'italic':
        insertAtSelection('*', '*', '强调内容');
        break;
      case 'quote':
        insertBlock('> ', '引用内容');
        break;
      case 'bullet-list':
        insertBlock('- ', '列表项');
        break;
      case 'ordered-list':
        insertBlock('1. ', '列表项');
        break;
      case 'code':
        insertAtSelection('`', '`', 'code');
        break;
      case 'link':
        insertAtSelection('[', '](https://)', '链接文字');
        break;
    }
  };

  return (
    <div
      className={cn(
        'grid min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_430px] dark:border-white/10 dark:bg-slate-950',
        className,
      )}
    >
      <section className="flex min-h-[440px] min-w-0 flex-col lg:min-h-0">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-white/[0.035]">
          <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-white/10">
            <button
              type="button"
              onClick={() => setMode('markdown')}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition',
                mode === 'markdown'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              <Pilcrow className="size-3.5" />
              Markdown
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition',
                mode === 'preview'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              <Eye className="size-3.5" />
              预览
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-0.5">
            {FORMAT_CONTROLS.map(({ label, icon: Icon, action }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="icon-sm"
                title={label}
                aria-label={label}
                onClick={() => applyFormat(action)}
                className="text-slate-500 hover:bg-white hover:text-violet-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-violet-300"
              >
                <Icon className="size-4" />
              </Button>
            ))}
          </div>
        </div>

        {mode === 'markdown' ? (
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            spellCheck
            className="min-h-[380px] flex-1 resize-none rounded-none border-0 bg-white px-5 py-4 font-mono text-[14px] leading-7 shadow-none focus-visible:ring-0 dark:bg-slate-950"
          />
        ) : (
          <div className="min-h-[380px] flex-1 overflow-y-auto px-6 py-5">
            {value.trim() ? (
              <MessageResponse
                mode="static"
                className="text-[15px] leading-7 text-slate-700 dark:text-slate-200 [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-950 [&_pre]:text-slate-100 dark:[&_pre]:border-white/10"
              >
                {value}
              </MessageResponse>
            ) : (
              <div className="grid h-full min-h-72 place-items-center text-center text-sm text-slate-400">
                输入 Markdown 后，这里会显示排版和公式预览。
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 dark:border-white/10">
          <span>支持 Markdown、代码块与 $LaTeX$ 公式</span>
          <span>{value.length} 字符</span>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.025] lg:border-t-0 lg:border-l">
        <div className="grid grid-cols-3 gap-1 border-b border-slate-200 p-2 dark:border-white/10">
          <button
            type="button"
            onClick={() => setToolPanel('symbols')}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition',
              toolPanel === 'symbols'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-500 hover:bg-white hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white',
            )}
          >
            <Braces className="size-4" />
            符号表
          </button>
          <button
            type="button"
            onClick={() => setToolPanel('formula')}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition',
              toolPanel === 'formula'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-500 hover:bg-white hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white',
            )}
          >
            <SquareFunction className="size-4" />
            常用公式
          </button>
          <button
            type="button"
            onClick={() => setToolPanel('structures')}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition',
              toolPanel === 'structures'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-500 hover:bg-white hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white',
            )}
          >
            <Code2 className="size-4" />
            高级结构
          </button>
        </div>

        <div className="max-h-[340px] min-h-0 flex-1 overflow-y-auto p-3 lg:max-h-none">
          {toolPanel === 'symbols' ? (
            <div className="space-y-4">
              {SYMBOL_GROUPS.map((group) => (
                <section key={group.label}>
                  <h4 className="mb-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {group.label}
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {group.symbols.map(([latex, label]) => (
                      <button
                        key={`${group.label}-${latex}`}
                        type="button"
                        title={`${label} · ${latex}`}
                        aria-label={`${label} ${latex}`}
                        onClick={() => insertAtSelection(`$${latex}$`)}
                        className="grid h-10 min-w-11 place-items-center rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-violet-400/40 dark:hover:bg-violet-400/10 dark:hover:text-violet-200 [&_.katex]:text-[1.05em]"
                      >
                        <span
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{
                            __html: renderMathToHtml(latex, { forceInline: true }),
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : toolPanel === 'formula' ? (
            <div className="space-y-2">
              <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                点击后会把带 `$` 的 LaTeX 公式插入当前光标位置。
              </p>
              {FORMULA_EXAMPLES.map((formula) => (
                <button
                  key={formula.label}
                  type="button"
                  onClick={() => insertAtSelection(`$${formula.latex}$`)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_minmax(120px,0.8fr)] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-white/10 dark:bg-white/5 dark:hover:border-violet-400/40 dark:hover:bg-violet-400/10"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {formula.label}
                    </span>
                    <code className="mt-1 block break-all font-mono text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                      {formula.latex}
                    </code>
                  </span>
                  <span
                    className="min-w-0 overflow-x-auto rounded-lg bg-slate-50 px-2 py-3 text-center text-slate-900 dark:bg-slate-950 dark:text-white [&_.katex]:text-[1.05em]"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: renderMathToHtml(formula.latex, { forceInline: true }),
                    }}
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                表格会插入 Markdown；矩阵、分段函数等会插入独立显示的 LaTeX 结构。
              </p>
              {ADVANCED_STRUCTURES.map((structure) => (
                <button
                  key={structure.label}
                  type="button"
                  onClick={() => insertStructure(structure)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-white/10 dark:bg-white/5 dark:hover:border-violet-400/40 dark:hover:bg-violet-400/10"
                >
                  <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {structure.label}
                  </span>
                  {structure.kind === 'math' ? (
                    <span
                      className="mt-2 block min-h-12 overflow-x-auto rounded-lg bg-slate-50 px-2 py-3 text-center text-slate-900 dark:bg-slate-950 dark:text-white [&_.katex]:text-[1.02em]"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{
                        __html: renderMathToHtml(structure.source, { displayMode: true }),
                      }}
                    />
                  ) : (
                    <span className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-950">
                      <span className="grid grid-cols-2 border-b border-slate-200 px-2 py-1.5 text-[11px] font-semibold dark:border-white/10">
                        <span>项目</span>
                        <span className="text-right">数值</span>
                      </span>
                      <span className="grid grid-cols-2 px-2 py-1.5 text-[11px] text-slate-500">
                        <span>A</span>
                        <span className="text-right">1</span>
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
