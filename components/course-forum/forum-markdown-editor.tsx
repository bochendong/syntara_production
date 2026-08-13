'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
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
  ListTree,
  Pilcrow,
  Quote,
  Rows3,
  SquareFunction,
  Table2,
  Grid3X3,
} from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { normalizeForumMarkdownForDisplay } from '@/lib/course-forum/markdown';
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
  { label: '定积分', latex: '\\int\\limits_{0}^{1} f(x)\\,dx', display: true },
  { label: '求和', latex: '\\sum\\limits_{i=1}^{n} a_i', display: true },
  { label: '乘积', latex: '\\prod\\limits_{i=1}^{n} a_i', display: true },
  { label: '大并集', latex: '\\bigcup\\limits_{i=1}^{n} A_i', display: true },
  {
    label: '极限',
    latex: '\\lim\\limits_{x\\to 0} \\frac{\\sin x}{x}=1',
    display: true,
  },
] as const;

const STRUCTURE_LIMITS = {
  tableRows: { min: 1, max: 12 },
  tableCols: { min: 1, max: 8 },
  matrix: { min: 2, max: 8 },
  formulaRows: { min: 2, max: 10 },
} as const;

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function generateMarkdownTable(rows: number, cols: number) {
  const header = Array.from({ length: cols }, (_, index) => `列 ${index + 1}`);
  const separator = Array.from({ length: cols }, () => '---');
  const body = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) => `内容 ${rowIndex + 1}-${colIndex + 1}`),
  );
  return [header, separator, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n');
}

function generateMatrix(rows: number, cols: number) {
  const body = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) => `a_{${rowIndex + 1}${colIndex + 1}}`).join(' & '),
  ).join(' \\\\\n');
  return `\\begin{bmatrix}\n${body}\n\\end{bmatrix}`;
}

function generatePiecewise(rows: number) {
  const body = Array.from(
    { length: rows },
    (_, index) => `f_{${index + 1}}(x), & x \\in D_{${index + 1}}`,
  ).join(' \\\\\n');
  return `f(x)=\\begin{cases}\n${body}\n\\end{cases}`;
}

function generateEquationSystem(rows: number) {
  const body = Array.from(
    { length: rows },
    (_, index) => `a_{${index + 1}}x+b_{${index + 1}}y=c_{${index + 1}}`,
  ).join(' \\\\\n');
  return `\\begin{cases}\n${body}\n\\end{cases}`;
}

function generateAligned(rows: number) {
  const body = Array.from({ length: rows }, (_, index) =>
    index === 0 ? 'a&=b+c' : `&=u_{${index + 1}}+v_{${index + 1}}`,
  ).join(' \\\\\n');
  return `\\begin{aligned}\n${body}\n\\end{aligned}`;
}

type EditorMode = 'markdown' | 'preview';
type ToolPanel = 'symbols' | 'formula' | 'structures';
type StructureKind = 'table' | 'matrix' | 'piecewise' | 'equations' | 'aligned';
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

const STRUCTURE_OPTIONS = [
  {
    kind: 'table',
    label: 'Markdown 表格',
    description: '自定义行数和列数',
    icon: Table2,
  },
  { kind: 'matrix', label: '矩阵', description: '2×2 至 8×8', icon: Grid3X3 },
  {
    kind: 'piecewise',
    label: '分段函数',
    description: '自定义分段数',
    icon: ListTree,
  },
  {
    kind: 'equations',
    label: '方程组',
    description: '自定义方程数',
    icon: Braces,
  },
  {
    kind: 'aligned',
    label: '多行推导',
    description: '自定义推导行数',
    icon: Rows3,
  },
] as const satisfies ReadonlyArray<{
  kind: StructureKind;
  label: string;
  description: string;
  icon: typeof Table2;
}>;

function StructureNumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="min-w-[88px] text-[11px] font-semibold text-slate-500 dark:text-slate-400">
      <span className="mb-1.5 block">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onChange(clampInteger(Number(event.target.value) || min, min, max))}
        className="h-9 rounded-lg bg-white text-center text-sm font-semibold shadow-none dark:bg-slate-950"
      />
    </label>
  );
}

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
  const [structureKind, setStructureKind] = useState<StructureKind>('table');
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [matrixRows, setMatrixRows] = useState(2);
  const [matrixCols, setMatrixCols] = useState(2);
  const [piecewiseRows, setPiecewiseRows] = useState(2);
  const [equationRows, setEquationRows] = useState(2);
  const [alignedRows, setAlignedRows] = useState(3);

  const generatedStructure = useMemo(() => {
    switch (structureKind) {
      case 'table':
        return {
          label: 'Markdown 表格',
          source: generateMarkdownTable(tableRows, tableCols),
          math: false,
          summary: `${tableRows} 行 × ${tableCols} 列`,
        };
      case 'matrix':
        return {
          label: '矩阵',
          source: generateMatrix(matrixRows, matrixCols),
          math: true,
          summary: `${matrixRows} × ${matrixCols}`,
        };
      case 'piecewise':
        return {
          label: '分段函数',
          source: generatePiecewise(piecewiseRows),
          math: true,
          summary: `${piecewiseRows} 段`,
        };
      case 'equations':
        return {
          label: '方程组',
          source: generateEquationSystem(equationRows),
          math: true,
          summary: `${equationRows} 行`,
        };
      case 'aligned':
        return {
          label: '多行推导',
          source: generateAligned(alignedRows),
          math: true,
          summary: `${alignedRows} 行`,
        };
    }
  }, [
    alignedRows,
    equationRows,
    matrixCols,
    matrixRows,
    piecewiseRows,
    structureKind,
    tableCols,
    tableRows,
  ]);

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

  const insertGeneratedStructure = useCallback(() => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const needsLeadingLineBreak = start > 0 && value[start - 1] !== '\n';
    const needsTrailingLineBreak = end < value.length && value[end] !== '\n';
    const leading = needsLeadingLineBreak ? '\n' : '';
    const trailing = needsTrailingLineBreak ? '\n' : '';
    const block = generatedStructure.math
      ? `${leading}$$\n${generatedStructure.source}\n$$${trailing}`
      : `${leading}${generatedStructure.source}${trailing}`;
    const next = `${value.slice(0, start)}${block}${value.slice(end)}`;
    const caretPosition = start + block.length;

    onChange(next);
    setMode('markdown');
    requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;
      nextTextarea?.focus();
      nextTextarea?.setSelectionRange(caretPosition, caretPosition);
    });
  }, [generatedStructure, onChange, value]);

  const insertFormula = useCallback(
    (formula: (typeof FORMULA_EXAMPLES)[number]) => {
      if ('display' in formula && formula.display) {
        const textarea = textareaRef.current;
        const start = textarea?.selectionStart ?? value.length;
        const end = textarea?.selectionEnd ?? value.length;
        const needsLeadingLineBreak = start > 0 && value[start - 1] !== '\n';
        const needsTrailingLineBreak = end < value.length && value[end] !== '\n';
        insertAtSelection(
          `${needsLeadingLineBreak ? '\n' : ''}$$\n`,
          `\n$$${needsTrailingLineBreak ? '\n' : ''}`,
          formula.latex,
        );
        return;
      }
      insertAtSelection(`$${formula.latex}$`);
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
                {normalizeForumMarkdownForDisplay(value)}
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
                            __html: renderMathToHtml(latex, {
                              forceInline: true,
                            }),
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
                  onClick={() => insertFormula(formula)}
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
                    className="min-w-0 overflow-x-auto rounded-lg bg-slate-50 px-2 py-3 text-center text-slate-900 dark:bg-slate-950 dark:text-white [&_.katex]:text-[1.05em] [&_.katex-display]:m-0"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: renderMathToHtml(formula.latex, {
                        displayMode: 'display' in formula && formula.display,
                        forceInline: !('display' in formula && formula.display),
                      }),
                    }}
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {STRUCTURE_OPTIONS.map(({ kind, label, description, icon: Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setStructureKind(kind)}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition',
                      structureKind === kind
                        ? 'border-violet-300 bg-violet-50 text-violet-800 shadow-sm dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50/50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-violet-400/30 dark:hover:bg-violet-400/[0.06]',
                    )}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      <Icon className="size-4 shrink-0" />
                      {label}
                    </span>
                    <span className="mt-1 block text-[10px] text-slate-400 dark:text-slate-500">
                      {description}
                    </span>
                  </button>
                ))}
              </div>

              <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {generatedStructure.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      当前生成：{generatedStructure.summary}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg bg-violet-600 px-3 text-xs hover:bg-violet-700"
                    onClick={insertGeneratedStructure}
                  >
                    插入结构
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  {structureKind === 'table' ? (
                    <>
                      <StructureNumberInput
                        label="数据行数"
                        value={tableRows}
                        {...STRUCTURE_LIMITS.tableRows}
                        onChange={setTableRows}
                      />
                      <StructureNumberInput
                        label="列数"
                        value={tableCols}
                        {...STRUCTURE_LIMITS.tableCols}
                        onChange={setTableCols}
                      />
                    </>
                  ) : structureKind === 'matrix' ? (
                    <>
                      <StructureNumberInput
                        label="行数"
                        value={matrixRows}
                        {...STRUCTURE_LIMITS.matrix}
                        onChange={setMatrixRows}
                      />
                      <StructureNumberInput
                        label="列数"
                        value={matrixCols}
                        {...STRUCTURE_LIMITS.matrix}
                        onChange={setMatrixCols}
                      />
                    </>
                  ) : (
                    <StructureNumberInput
                      label={structureKind === 'piecewise' ? '分段数' : '行数'}
                      value={
                        structureKind === 'piecewise'
                          ? piecewiseRows
                          : structureKind === 'equations'
                            ? equationRows
                            : alignedRows
                      }
                      {...STRUCTURE_LIMITS.formulaRows}
                      onChange={
                        structureKind === 'piecewise'
                          ? setPiecewiseRows
                          : structureKind === 'equations'
                            ? setEquationRows
                            : setAlignedRows
                      }
                    />
                  )}
                </div>

                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-950">
                  {generatedStructure.math ? (
                    <span
                      className="block min-h-16 min-w-max text-center text-slate-900 dark:text-white [&_.katex-display]:m-0"
                      aria-label={`${generatedStructure.label}预览`}
                      dangerouslySetInnerHTML={{
                        __html: renderMathToHtml(generatedStructure.source, {
                          displayMode: true,
                        }),
                      }}
                    />
                  ) : (
                    <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-md text-center text-[11px] text-slate-600 dark:text-slate-300">
                      <thead>
                        <tr>
                          {Array.from({ length: tableCols }, (_, columnIndex) => (
                            <th
                              key={columnIndex}
                              className="min-w-20 border border-slate-200 bg-white px-2 py-1.5 font-semibold dark:border-white/10 dark:bg-white/5"
                            >
                              列 {columnIndex + 1}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: tableRows }, (_, rowIndex) => (
                          <tr key={rowIndex}>
                            {Array.from({ length: tableCols }, (_, columnIndex) => (
                              <td
                                key={columnIndex}
                                className="min-w-20 border border-slate-200 bg-slate-50/40 px-2 py-1.5 dark:border-white/10 dark:bg-slate-950"
                              >
                                内容 {rowIndex + 1}-{columnIndex + 1}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
