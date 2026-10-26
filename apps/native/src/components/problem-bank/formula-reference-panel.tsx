import { useState, type ReactNode } from 'react';
import { ProblemRichText } from './problem-rich-text';

// Matches the formula reference and builders in the web problem workspace.
const COMMON_LATEX_FORMULA_GROUPS = [
  {
    title: '基础结构',
    items: [
      { label: '分数', latex: String.raw`\frac{a}{b}` },
      { label: '平方根', latex: String.raw`\sqrt{x}` },
      { label: 'n 次方根', latex: String.raw`\sqrt[n]{x}` },
      { label: '上下标', latex: String.raw`x_i^2` },
      { label: '无穷', latex: String.raw`\infty` },
      { label: 'forall 符号', latex: String.raw`\forall` },
      { label: 'exists 符号', latex: String.raw`\exists` },
      { label: '省略号 dots', latex: String.raw`\dots` },
      { label: '中线省略号', latex: String.raw`\cdots` },
      { label: '底线省略号', latex: String.raw`\ldots` },
      { label: '竖省略号', latex: String.raw`\vdots` },
      { label: '斜省略号', latex: String.raw`\ddots` },
      { label: 'ceil', latex: String.raw`\lceil x \rceil` },
      { label: 'floor', latex: String.raw`\lfloor x \rfloor` },
    ],
  },
  {
    title: '微积分',
    items: [
      { label: '极限', latex: String.raw`\lim_{x\to a} f(x)` },
      { label: '导数', latex: String.raw`\frac{d}{dx} f(x)` },
      { label: '偏导数', latex: String.raw`\frac{\partial f}{\partial x}` },
      { label: '定积分', latex: String.raw`\int_a^b f(x)\,dx` },
      { label: '求和', latex: String.raw`\sum_{i=1}^{n} a_i` },
      { label: '无上下限求和', latex: String.raw`\sum a_i` },
      { label: '多项乘积', latex: String.raw`\prod_{i=1}^{n} a_i` },
    ],
  },
  {
    title: '集合与逻辑',
    items: [
      { label: '属于', latex: String.raw`x \in A` },
      { label: '不属于', latex: String.raw`x \notin A` },
      { label: '子集', latex: String.raw`A \subseteq B` },
      { label: '并集', latex: String.raw`A \cup B` },
      { label: '交集', latex: String.raw`A \cap B` },
      { label: '补集', latex: String.raw`A^c` },
      { label: '蕴含', latex: String.raw`P \Rightarrow Q` },
      { label: '当且仅当', latex: String.raw`P \Leftrightarrow Q` },
    ],
  },
  {
    title: '常用数集与希腊字母',
    items: [
      { label: '实数', latex: String.raw`\mathbb{R}` },
      { label: '整数', latex: String.raw`\mathbb{Z}` },
      { label: '自然数', latex: String.raw`\mathbb{N}` },
      { label: '大 Delta', latex: String.raw`\Delta` },
      { label: 'alpha', latex: String.raw`\alpha` },
      { label: 'beta', latex: String.raw`\beta` },
      { label: 'gamma', latex: String.raw`\gamma` },
      { label: 'theta', latex: String.raw`\theta` },
      { label: 'lambda', latex: String.raw`\lambda` },
      { label: 'epsilon', latex: String.raw`\epsilon` },
      { label: 'delta', latex: String.raw`\delta` },
    ],
  },
] as const;

const FORMULA_SIZE_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
const FORMULA_ROW_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
const FORMULA_SEGMENT_OPTIONS = [2, 3, 4, 5, 6] as const;
const FORMULA_ITEM_OPTIONS = [2, 3, 4, 5, 6] as const;

function inlineMathLatex(latex: string) {
  return `$${latex}$`;
}

function displayMathLatex(latex: string) {
  return `\\[\n${latex}\n\\]`;
}

function displayMathPreviewContent(latex: string) {
  return `$$\n${latex}\n$$`;
}

function generateMatrixLatex(rows: number, cols: number) {
  const body = Array.from({ length: rows }).map((_, rowIndex) => {
    const cells = Array.from({ length: cols })
      .map((__, colIndex) => `a_{${rowIndex + 1}${colIndex + 1}}`)
      .join(' & ');
    return `  ${cells}${rowIndex < rows - 1 ? String.raw` \\` : ''}`;
  });
  return [String.raw`\begin{bmatrix}`, ...body, String.raw`\end{bmatrix}`].join('\n');
}

function generateAlignedLatex(rows: number) {
  const body = Array.from(
    { length: rows },
    (_, index) =>
      `  x_{${index + 1}} &= y_{${index + 1}}${index < rows - 1 ? String.raw` \\` : ''}`,
  );
  return [String.raw`\begin{aligned}`, ...body, String.raw`\end{aligned}`].join('\n');
}

function generateCasesLatex(segments: number) {
  const body = Array.from(
    { length: segments },
    (_, index) =>
      `  expr_{${index + 1}}, & cond_{${index + 1}}${index < segments - 1 ? String.raw` \\` : ''}`,
  );
  return [String.raw`f(x)=\begin{cases}`, ...body, String.raw`\end{cases}`].join('\n');
}

function generateTableLatex(rows: number, cols: number) {
  const alignment = `|${Array.from({ length: cols }, () => 'c').join('|')}|`;
  const body = Array.from({ length: rows }).flatMap((_, rowIndex) => {
    const cells = Array.from({ length: cols })
      .map((__, colIndex) => `cell_{${rowIndex + 1}${colIndex + 1}}`)
      .join(' & ');
    return [`  ${cells} ${String.raw`\\`}`, String.raw`\hline`];
  });
  return [
    `\\begin{array}{${alignment}}`,
    String.raw`\hline`,
    ...body,
    String.raw`\end{array}`,
  ].join('\n');
}

function generateEnumerateLatex(items: number) {
  const body = Array.from({ length: items })
    .map((_, index) => String.raw`\item item ${index + 1}`)
    .join('\n');
  return `${String.raw`\begin{enumerate}`}\n${body}\n${String.raw`\end{enumerate}`}`;
}

export function FormulaReferencePanel({
  locale,
  onInsert,
}: {
  locale: 'zh-CN' | 'en-US';
  onInsert: (latex: string) => void;
}) {
  const [matrixRows, setMatrixRows] = useState(2);
  const [matrixCols, setMatrixCols] = useState(2);
  const [alignedRows, setAlignedRows] = useState(2);
  const [caseSegments, setCaseSegments] = useState(2);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [enumerateItems, setEnumerateItems] = useState(3);

  const matrixLatex = generateMatrixLatex(matrixRows, matrixCols);
  const alignedLatex = generateAlignedLatex(alignedRows);
  const casesLatex = generateCasesLatex(caseSegments);
  const tableLatex = generateTableLatex(tableRows, tableCols);
  const enumerateLatex = generateEnumerateLatex(enumerateItems);

  return (
    <div className="pp-formula-sheet mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">
          {locale === 'zh-CN' ? '常见 LaTeX 公式表' : 'Common LaTeX formulas'}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {locale === 'zh-CN'
            ? '点击「插入」将公式放到右侧答案的光标位置。'
            : 'Use the source snippets on the right when writing an answer.'}
        </p>
      </div>

      {COMMON_LATEX_FORMULA_GROUPS.map((group) => (
        <section key={group.title} className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {group.title}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full border-collapse text-sm leading-6">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900/80 dark:text-slate-400">
                <tr>
                  <th className="w-24 px-3 py-2 text-left">
                    {locale === 'zh-CN' ? '用途' : 'Use'}
                  </th>
                  <th className="px-3 py-2 text-left">LaTeX</th>
                  <th className="w-44 px-3 py-2 text-left">
                    {locale === 'zh-CN' ? '预览' : 'Preview'}
                  </th>
                  <th className="w-20 px-3 py-2 text-right">
                    {locale === 'zh-CN' ? '操作' : 'Action'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr
                    key={`${group.title}-${item.label}`}
                    className="border-t border-slate-200 dark:border-slate-800"
                  >
                    <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                      {item.label}
                    </td>
                    <td className="px-3 py-2">
                      <code className="rounded bg-slate-100 px-1.5 py-1 font-mono text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        {inlineMathLatex(item.latex)}
                      </code>
                    </td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">
                      <ProblemRichText
                        content={`$${item.latex}$`}
                        className="[&_p]:m-0 [&_.katex-display]:m-0"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="h-7 rounded-md px-2 text-xs font-semibold text-sky-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:border-slate-700 dark:text-sky-200 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/10"
                        onClick={() => onInsert(inlineMathLatex(item.latex))}
                      >
                        {locale === 'zh-CN' ? '插入' : 'Insert'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section aria-label={locale === 'zh-CN' ? '矩阵' : 'Matrix'}>
        <FormulaBuilderCard
          title={locale === 'zh-CN' ? '矩阵' : 'Matrix'}
          latex={matrixLatex}
          insertLatex={displayMathLatex(matrixLatex)}
          locale={locale}
          onInsert={() => onInsert(displayMathLatex(matrixLatex))}
        >
          <FormulaNumberSelect
            label={locale === 'zh-CN' ? '行' : 'Rows'}
            value={matrixRows}
            options={FORMULA_SIZE_OPTIONS}
            onChange={setMatrixRows}
          />
          <FormulaNumberSelect
            label={locale === 'zh-CN' ? '列' : 'Cols'}
            value={matrixCols}
            options={FORMULA_SIZE_OPTIONS}
            onChange={setMatrixCols}
          />
        </FormulaBuilderCard>
      </section>

      <section aria-label={locale === 'zh-CN' ? '分段函数' : 'Piecewise'}>
        <FormulaBuilderCard
          title={locale === 'zh-CN' ? '分段函数' : 'Piecewise'}
          latex={casesLatex}
          insertLatex={displayMathLatex(casesLatex)}
          locale={locale}
          onInsert={() => onInsert(displayMathLatex(casesLatex))}
        >
          <FormulaNumberSelect
            label={locale === 'zh-CN' ? '段数' : 'Pieces'}
            value={caseSegments}
            options={FORMULA_SEGMENT_OPTIONS}
            onChange={setCaseSegments}
          />
        </FormulaBuilderCard>
      </section>

      <section aria-label="aligned">
        <FormulaBuilderCard
          title="aligned"
          latex={alignedLatex}
          insertLatex={displayMathLatex(alignedLatex)}
          locale={locale}
          onInsert={() => onInsert(displayMathLatex(alignedLatex))}
        >
          <FormulaNumberSelect
            label={locale === 'zh-CN' ? '行数' : 'Rows'}
            value={alignedRows}
            options={FORMULA_ROW_OPTIONS}
            onChange={setAlignedRows}
          />
        </FormulaBuilderCard>
      </section>

      <section aria-label="table">
        <TableBuilderCard
          locale={locale}
          rows={tableRows}
          cols={tableCols}
          latex={tableLatex}
          onRowsChange={setTableRows}
          onColsChange={setTableCols}
          onInsert={() => onInsert(displayMathLatex(tableLatex))}
        />
      </section>

      <section aria-label="enumerate">
        <EnumerateBuilderCard
          locale={locale}
          items={enumerateItems}
          latex={enumerateLatex}
          onItemsChange={setEnumerateItems}
          onInsert={() => onInsert(enumerateLatex)}
        />
      </section>
    </div>
  );
}

function FormulaNumberSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: readonly number[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-500/20"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function FormulaBuilderCard({
  title,
  latex,
  insertLatex,
  locale,
  children,
  onInsert,
}: {
  title: string;
  latex: string;
  insertLatex?: string;
  locale: 'zh-CN' | 'en-US';
  children: ReactNode;
  onInsert: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
          <div className="mt-2 flex flex-wrap gap-2">{children}</div>
        </div>
        <button
          type="button"
          className="h-7 rounded-md px-2 text-xs font-semibold text-sky-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:border-slate-700 dark:text-sky-200 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/10"
          onClick={onInsert}
        >
          {locale === 'zh-CN' ? '插入' : 'Insert'}
        </button>
      </div>
      <div className="mt-3 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950">
        <ProblemRichText
          content={displayMathPreviewContent(latex)}
          className="[&_p]:m-0 [&_.katex-display]:m-0"
        />
      </div>
      <code className="mt-2 block whitespace-pre-wrap break-words rounded bg-white px-2 py-1 font-mono text-[11px] leading-5 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        {insertLatex ?? latex}
      </code>
    </div>
  );
}

function TableBuilderCard({
  locale,
  rows,
  cols,
  latex,
  onRowsChange,
  onColsChange,
  onInsert,
}: {
  locale: 'zh-CN' | 'en-US';
  rows: number;
  cols: number;
  latex: string;
  onRowsChange: (value: number) => void;
  onColsChange: (value: number) => void;
  onInsert: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">table</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <FormulaNumberSelect
              label={locale === 'zh-CN' ? '行' : 'Rows'}
              value={rows}
              options={FORMULA_SIZE_OPTIONS}
              onChange={onRowsChange}
            />
            <FormulaNumberSelect
              label={locale === 'zh-CN' ? '列' : 'Cols'}
              value={cols}
              options={FORMULA_SIZE_OPTIONS}
              onChange={onColsChange}
            />
          </div>
        </div>
        <button
          type="button"
          className="h-7 rounded-md px-2 text-xs font-semibold text-sky-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:border-slate-700 dark:text-sky-200 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/10"
          onClick={onInsert}
        >
          {locale === 'zh-CN' ? '插入' : 'Insert'}
        </button>
      </div>
      <div className="mt-3 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950">
        <ProblemRichText
          content={displayMathPreviewContent(latex)}
          className="[&_p]:m-0 [&_.katex-display]:m-0"
        />
      </div>
      <code className="mt-2 block whitespace-pre-wrap break-words rounded bg-white px-2 py-1 font-mono text-[11px] leading-5 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        {displayMathLatex(latex)}
      </code>
    </div>
  );
}

function EnumerateBuilderCard({
  locale,
  items,
  latex,
  onItemsChange,
  onInsert,
}: {
  locale: 'zh-CN' | 'en-US';
  items: number;
  latex: string;
  onItemsChange: (value: number) => void;
  onInsert: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">enumerate</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <FormulaNumberSelect
              label={locale === 'zh-CN' ? '条目' : 'Items'}
              value={items}
              options={FORMULA_ITEM_OPTIONS}
              onChange={onItemsChange}
            />
          </div>
        </div>
        <button
          type="button"
          className="h-7 rounded-md px-2 text-xs font-semibold text-sky-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:border-slate-700 dark:text-sky-200 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/10"
          onClick={onInsert}
        >
          {locale === 'zh-CN' ? '插入' : 'Insert'}
        </button>
      </div>
      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
        <ol className="m-0 list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
          {Array.from({ length: items }).map((_, index) => (
            <li key={index}>item {index + 1}</li>
          ))}
        </ol>
      </div>
      <code className="mt-2 block whitespace-pre-wrap rounded bg-white px-2 py-1 font-mono text-[11px] leading-5 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        {latex}
      </code>
    </div>
  );
}
