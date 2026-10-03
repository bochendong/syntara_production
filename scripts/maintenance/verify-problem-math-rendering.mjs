import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  jsx: { runtime: 'automatic' },
});
const { renderProblemRichTextHtml } = await jiti.import(
  '../../components/problem-bank/problem-rich-text.tsx',
);
const { renderTextWithMathToHtml } = await jiti.import('../../lib/math-engine/index.ts');

for (const formula of ["A'(2020)", 'A(2025)', "f''(x)"]) {
  assert.match(renderTextWithMathToHtml(`估计 ${formula}，并给出单位。`), /data-syntara-math/);
}
for (const source of [
  '**公式 $x_1+x_2$**',
  '$$\\begin{aligned}x_1&=1\\\\x_2&=2\\end{aligned}$$',
  '$\\frac{1}{1+x^2}$',
  "\\(f'(x)=2x\\)",
]) {
  const html = renderProblemRichTextHtml(source);
  assert.match(html, /data-syntara-math/);
  assert.doesNotMatch(html, /katex-error/);
  if (source.startsWith('**')) assert.match(html, /<strong>公式 <span/);
}
const code = renderProblemRichTextHtml("`A'(2020)`\n\n```python\nx_1 = 1\n```");
assert.doesNotMatch(code, /data-syntara-math/);
assert.match(code.replace(/<[^>]*>/g, ''), /x_1 = 1/);
for (const prose of ['NASA records temperature.', 'print(2020)']) {
  assert.equal(renderTextWithMathToHtml(prose), null);
}
const cases = renderProblemRichTextHtml(
  '$f(x)=\\begin{cases}x & x>0\\\\0 & x\\leq0\\end{cases}$\n\n求导数。',
);
assert.match(cases, /<p>求导数。<\/p>/);
assert.doesNotMatch(cases, /katex-error/);
const { choiceDisplayLabel } = await jiti.import('../../lib/problem-bank/choice-display.ts');
assert.equal(choiceDisplayLabel('nonneg_avo', 0), 'A');
assert.equal(choiceDisplayLabel('constraint_1', 2), 'C');
assert.equal(choiceDisplayLabel('F', 1), 'F');
const labelledPoint = renderProblemRichTextHtml('binding at (Avo Roll, Cali Roll) = (6, 8.5).');
assert.match(labelledPoint, /Avo Roll, Cali Roll/);
assert.doesNotMatch(labelledPoint, /<mi[^>]*>at<\/mi>/);
const cakeTable = renderProblemRichTextHtml(String.raw`| $b$ (teaspoons) | $0$ | $1$ | $3$ | $6$ |
|---|---:|---:|---:|---:|
| $f(b)$ (centimetres) | $2.0$ | $2.4$ | $3.0$ | $3.5$ |`);
assert.equal((cakeTable.match(/<th>/g) ?? []).length, 5);
assert.equal((cakeTable.match(/<td>/g) ?? []).length, 5);
assert.equal((cakeTable.match(/data-syntara-math=/g) ?? []).length, 10);
assert.doesNotMatch(cakeTable, /\|/);
const literalPipeTable = renderProblemRichTextHtml(String.raw`| Expression | Price | Other price |
|---|---|---|
| $2|x|$ | $100 | $200 |`);
assert.equal((literalPipeTable.match(/<td>/g) ?? []).length, 3);
console.log('Problem math rendering regression checks passed.');
