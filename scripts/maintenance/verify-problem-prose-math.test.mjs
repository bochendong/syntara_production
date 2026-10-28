import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createJiti } from 'jiti';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const helpers = await jiti.import('../../lib/problem-bank/problem-prose-math.ts');
const repair = helpers.repairProblemProseMath;
async function renderer(native) {
  const math = await jiti.import(
    path.resolve(native ? 'apps/native/src/lib/math-engine/index.ts' : 'lib/math-engine/index.ts'),
  );
  const html = await jiti.import(
    path.resolve(
      native ? 'apps/native/src/lib/render-html-with-latex.ts' : 'lib/render-html-with-latex.ts',
    ),
  );
  const mocks = {
    '../../lib/math-engine': math,
    '@/lib/math-engine': math,
    '../../lib/render-html-with-latex': html,
    '@/lib/render-html-with-latex': html,
    '../../../../../lib/problem-bank/problem-prose-math': helpers,
    '@/lib/problem-bank/problem-prose-math': helpers,
    '@/lib/problem-bank/markdown-structure': await jiti.import(
      '../../lib/problem-bank/markdown-structure.ts',
    ),
    '@/lib/problem-bank/repair-malformed-math': await jiti.import(
      '../../lib/problem-bank/repair-malformed-math.ts',
    ),
    '../../../../../lib/problem-bank/zoomable-problem-image': {},
    '@/lib/problem-bank/zoomable-problem-image': {},
    '../../lib/cn': {},
    '@/lib/utils': {},
  };
  const filename = native
    ? 'apps/native/src/components/problem-bank/problem-rich-text.tsx'
    : 'components/problem-bank/problem-rich-text.tsx';
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (id) => (id in mocks ? mocks[id] : require(id)),
    mod,
    mod.exports,
  );
  const render = mod.exports.renderProblemRichTextHtml;
  return render;
}
for (const native of [true, false]) {
  const render = await renderer(native);
  test(`${native ? 'native' : 'web'} renders the three reported math statements`, () => {
    const numbers = render(
      '8 小时销量 16{,}690 张，16 小时后为 100{,}000 张，随后增加 5{,}000 张。',
    );
    assert.ok(numbers.includes('16,690'));
    assert.ok(numbers.includes('100,000'));
    assert.ok(numbers.includes('5,000'));
    assert.ok(!numbers.includes('{,}'));
    const graph = render('原函数为 $F(x)=\\sqrt[5]{2x}$。说明图像相对于 `y=F(x)` 的变换。');
    assert.ok(!graph.includes('problem-rich-inline-code'));
    assert.ok((graph.match(/data-syntara-math=/g) ?? []).length >= 2);
    assert.ok(!graph.includes('katex-error'));
    const logarithm = render(
      '使用 $x=\\log_2(DE)$ 和 `y=\\log_{10}(G)`，拟合直线为 $y=2.25+0.625x$。',
    );
    assert.ok(!logarithm.includes('problem-rich-inline-code'));
    assert.ok((logarithm.match(/data-syntara-math=/g) ?? []).length >= 3);
    assert.ok(!logarithm.includes('katex-error'));
    for (const formula of ['$y=F(x)$', String.raw`$y=\log_{10}(G)$`]) {
      const math = render(formula);
      assert.ok(math.includes('data-syntara-math='));
      assert.ok(!math.includes('<code'));
    }
  });
  test(`${native ? 'native' : 'web'} protects formulas before parsing Markdown`, () => {
    const source = String.raw`The constraints are:
$\begin{aligned}
x_1 &= 2\\
x_2 &= 3
\end{aligned}$

The value is $PV=100{,}000\left[\frac{1-(1.05)^{-5}}{0.05}\right]=\$432{,}947.67$.`;
    const html = render(source);
    assert.equal((html.match(/data-syntara-math=/g) ?? []).length, 2);
    assert.ok(!html.includes('katex-error'));
    assert.ok(!html.includes('SYNPROTECTEDMATH'));
    assert.ok(!html.includes('<em>'));
    const cases = render(String.raw`$$
        j(x)=\begin{cases}(x,0),&x\in S,\\(x,1),&x\notin S.\end{cases}
        $$`);
    assert.ok(cases.includes('data-syntara-math='));
    assert.ok(!cases.includes('katex-error'));
    assert.ok(!cases.includes('\\begin{cases}'));
    const oneColumn = render('| Reaction |\n|---|\n| A + B |\n| G + F |');
    assert.ok(oneColumn.includes('<table>'));
    assert.equal((oneColumn.match(/<td>/g) ?? []).length, 2);
    const table = render(
      'Complete the table:\n| Call | Output |\n|---|---|\n| `f(1)` | |\n| `f(2)` | |',
    );
    assert.ok(table.includes('<table>'));
    assert.equal((table.match(/<tbody><tr>|<\/tr><tr>/g) ?? []).length, 2);
    assert.ok(!table.includes('|---|'));
  });
  test(`${native ? 'native' : 'web'} retains legacy dollar-run repairs`, () => {
    const source = String.raw`$某厂商的生产函数为$ Q=K^{1/2}L^{1/2}. $短期资本固定为$ K=16 $。$$$`;
    const html = render(source);
    assert.ok(!html.includes('$$$'));
    assert.ok(!html.includes('katex-error'));
    assert.ok((html.match(/data-syntara-math=/g) ?? []).length >= 2);
    const valid = String.raw`$PV=100{,}000=\$432{,}947.67$`;
    assert.equal(repair(valid), valid);
  });
  test(`${native ? 'native' : 'web'} retains programming inline code`, () => {
    const html = render('Python assigns `y=F(x)`, calls `len(s)`, and prints `print("\\log")`.');
    const fenced = render('```python\nx = {"price": "$100"}\nprint(x)\n```');
    assert.ok(fenced.includes('price') && fenced.includes('$100'));
    assert.ok(!fenced.includes('data-syntara-math='));
    assert.equal((html.match(/class="problem-rich-inline-code"/g) ?? []).length, 3);
  });
}
test('repairs prose idempotently and protects existing math and literal code', () => {
  const unchanged = [
    String.raw`$16{,}690$`,
    String.raw`\(16{,}690\)`,
    String.raw`\[16{,}690\]`,
    '``y=\\log_{10}(G)``',
    '```python\nprint("16{,}690")\nprint("\\log")\n```',
    '````python\n# ```\nprint("16{,}690")\n````',
    '~~~~python\nprint("16{,}690")\n~~~~',
  ];
  for (const source of unchanged) assert.equal(repair(source), source);
  for (const source of ['销量 16{,}690 张', '图像相对于 `y=F(x)` 的变换。', '`y=\\log_{10}(G)`'])
    assert.equal(repair(repair(source)), repair(source));
});
