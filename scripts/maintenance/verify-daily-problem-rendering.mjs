import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  jsx: { runtime: 'automatic' },
});
for (const file of [
  '../../components/problem-bank/problem-rich-text.tsx',
  '../../apps/native/src/components/problem-bank/problem-rich-text.tsx',
]) {
  const { renderProblemRichTextHtml: render } = await jiti.import(file);
  const prompt = '>>> obj.__init__(2)\n>>> obj.value\n2';
  const html = render(prompt + '\n\nExplain the result.');
  assert.match(html, /<pre/);
  assert.doesNotMatch(html, /<blockquote/);
  assert.match(html, /__init__/);
  assert.match(html, /Explain the result/);
  const duplicate = render(prompt + '\n\n```python\n' + prompt + '\n```');
  assert.equal((duplicate.match(/<pre/g) || []).length, 1);
  const fenced = render('```python\n>>> x = "<script>"\n```');
  assert.equal((fenced.match(/<pre/g) || []).length, 1);
  assert.doesNotMatch(fenced, /<script>/);
  assert.match(render('Find $x \\rightarrow 0$.'), /rightarrow/);
  const subparts = render('(a) First part (b) Second part');
  assert.match(subparts, /First part/);
  assert.match(subparts, /Second part/);
  console.log('PASS doctests, duplicate fences, dunder names, escaping, math and subparts:', file);
}

for (const file of [
  '../../lib/math-engine/index.ts',
  '../../apps/native/src/lib/math-engine/index.ts',
]) {
  const { renderTextWithMathToHtml } = await jiti.import(file);
  assert.match(renderTextWithMathToHtml('Find $x \\rightarrow 0$.'), /katex/);
}
