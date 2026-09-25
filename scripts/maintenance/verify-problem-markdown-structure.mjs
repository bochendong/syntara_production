import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function('require', 'module', 'exports', code)(
    (name) => dependencies[name] ?? require(name),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}
const structure = load('lib/problem-bank/markdown-structure.ts');
const mathRepair = load('lib/problem-bank/repair-malformed-math.ts');
const importText = load('lib/server/notebook-problems/import.core.text.ts', {
  '@/lib/problem-bank/repair-malformed-math': mathRepair,
});
const latexUtils = load('lib/latex-utils.ts');
const mathEngine = load('lib/math-engine/index.ts', {
  '@/lib/latex-utils': latexUtils,
});
const { renderProblemRichTextHtml: render } = load(
  'components/problem-bank/problem-rich-text.tsx',
  {
    '@/lib/problem-bank/markdown-structure': structure,
    '@/lib/problem-bank/repair-malformed-math': mathRepair,
    '@/lib/render-html-with-latex': { renderHtmlWithLatex: (x) => x },
    '@/lib/math-engine': {},
    '@/lib/utils': {},
  },
);
const legacy = [
  'Preserve the line breaks in each answer.',
  '',
  '| Code | What is printed |',
  '|---|---|',
  '| ```python',
  "for vowel in 'aeiou':",
  '    print(vowel)',
  'print(vowel)',
  '``` | {{first}} |',
  '| ```python',
  "s = 'cat'",
  'for c in s:',
  '    print(c * len(s))',
  '``` | {{second}} |',
].join('\n');
const expanded = structure.expandLegacyCodeTables(legacy);
assert(expanded.includes("for vowel in 'aeiou':\n    print(vowel)\nprint(vowel)"));
assert(expanded.includes('{{first}}') && expanded.includes('{{second}}'));
assert.equal(structure.expandLegacyCodeTables(expanded), expanded);
const html = render(legacy);
assert.equal((html.match(/<pre /g) || []).length, 2);
assert(!html.includes('```') && !html.includes('|---|'));
assert(html.includes('    <span') && html.includes('{{first}}'));
const breaks = render('| Doctest | Answer |\n|---|---|\n| `>>> f()`<br>`1`<BR />`2` | {{a}} |');
assert(breaks.includes('</code><br/><code'));
assert(!breaks.includes('&lt;br'));
const literals = render(
  '`<br>`\n\n```html\n<br>\n```\n\n<img src=x onerror=alert(1)><br onclick=alert(1)>',
);
assert(literals.includes('&lt;br&gt;'));
assert(!literals.includes('<img') && !literals.includes('<br onclick'));
const nested = '````text\n' + legacy + '\n````';
assert.equal(structure.expandLegacyCodeTables(nested), nested);
const incomplete = legacy.replace('``` | {{second}} |', '');
assert.equal(structure.expandLegacyCodeTables(incomplete), incomplete);
const malformedMathStems = [
  {
    raw: String.raw`$$ $某厂商处于短期，资本投入固定为$ K=16 $。资本的租赁价格为每单位$ r=40 $美元。$ 求厂商的短期固定成本。$`,
    expectedMath: ['K=16', 'r=40'],
  },
  {
    raw: String.raw`$$$ $某厂商处于短期，使用劳动$ L $和资本$ K $生产产品。其生产函数为$ Q=K^{1/2}L^{1/2}, $劳动的边际产量为$ MPL=\\frac{1}{2}K^{1/2}L^{-1/2}. $已知：$ - 产品价格为每单位 $p=200$ 美元； $- 工资率为每单位劳动$ w=10 $美元；$ - 资本投入固定为 $K=16$； $- 资本租赁价格为每单位$ r=40 $美元。$ 假定厂商为价格接受者且采用内部解，求短期利润最大化产量 $Q$。$$$`,
    expectedMath: [
      'L',
      'K',
      'Q=K^{1/2}L^{1/2}',
      'MPL=\\frac{1}{2}K^{1/2}L^{-1/2}',
      'p=200',
      'w=10',
      'K=16',
      'r=40',
      'Q',
    ],
  },
  {
    raw: String.raw`$某厂商的生产函数为$ Q=K^{1/2}L^{1/2}. $短期资本固定为$ K=16 $，工资率为$ w=10 $，资本租赁价格为$ r=40 $。厂商在短期利润最大化时生产$ Q=160 $。$ 求此时的总成本 $ $TC=wL+rK.$ 答案以美元表示。$$$`,
    expectedMath: ['Q=K^{1/2}L^{1/2}', 'K=16', 'w=10', 'r=40', 'Q=160', 'TC=wL+rK'],
  },
  {
    raw: String.raw`$某小型开放经济中，一种商品的供给曲线和需求曲线分别为$ p=5+Q_s $p=80-2Q_d$ 世界市场价格为 $p_w=14$。该国实行自由贸易且可以按世界价格任意进口。计算该国的进口数量。$$$`,
    expectedMath: ['p=5+Q_s', 'p=80-2Q_d', 'p_w=14'],
  },
];
for (const { raw, expectedMath } of malformedMathStems) {
  const repaired = mathRepair.repairMalformedProblemMath(raw);
  assert(!repaired.includes('$$$') && !repaired.startsWith('$'));
  assert(!repaired.includes('$$'), 'stray display delimiters should be removed');
  const math = mathEngine
    .parseMathFragments(repaired)
    .filter((fragment) => fragment.type === 'math');
  assert.deepEqual(
    math.map((fragment) => fragment.value),
    expectedMath,
  );
  for (const fragment of math) {
    assert(mathEngine.renderMathToHtml(fragment.value).includes('data-syntara-math'));
  }
  assert(render(raw).includes('<p>'));
}
assert.equal(
  mathRepair.repairMalformedProblemMath('已知 $x=2$，求 $x^2$。'),
  '已知 $x=2$，求 $x^2$。',
);
assert.equal(mathRepair.repairMalformedProblemMath('$$\\frac{a}{b}$$'), '$$\\frac{a}{b}$$');
const numericMath = mathRepair.repairMalformedProblemMath(
  '$某商品的供给函数和需求函数分别为$ Q_s=4p-5, $Q_d=40-0.5p$ 政府实行每单位 $20$ 美元的价格下限。',
);
assert(numericMath.includes('$Q_s=4p-5$，$Q_d=40-0.5p$'));
assert(numericMath.includes('$20$') && !numericMath.includes('$,、$'));
assert.equal(
  mathRepair.repairMalformedProblemMath(String.raw`A budget of \\ $50, and a cup costs \\$ 2.`),
  'A budget of USD 50, and a cup costs USD 2.',
);
for (const { raw, expectedMath } of malformedMathStems) {
  const importedMath = importText.normalizeMathMarkdown(raw);
  assert(!importedMath.includes('$$$') && !importedMath.startsWith('$'));
  const importedFragments = mathEngine
    .parseMathFragments(importedMath)
    .filter((fragment) => fragment.type === 'math');
  for (const expression of expectedMath) {
    assert(importedFragments.some((fragment) => fragment.value === expression));
  }
}
assert.equal(
  mathRepair.repairMalformedProblemMath('`$某内容$`\n```python\nprint("$某内容$")\n```'),
  '`$某内容$`\n```python\nprint("$某内容$")\n```',
);
const { problemContentReadinessErrors } = load('lib/problem-bank/content-readiness.ts');
const draft = {
  publicContent: { type: 'short_answer', stem: legacy },
  grading: { type: 'short_answer' },
};
assert(problemContentReadinessErrors(draft).some((e) => e.includes('多行代码不得')));
assert.deepEqual(
  problemContentReadinessErrors({
    ...draft,
    publicContent: { ...draft.publicContent, stem: expanded },
  }),
  [],
);
console.log(
  'PASS: legacy code table, indentation, blank preservation, line breaks, escaped HTML, fence protection, incomplete data and generation rejection',
);
