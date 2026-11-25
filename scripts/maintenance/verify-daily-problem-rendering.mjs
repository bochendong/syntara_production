import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createJiti } from 'jiti';
// Node renders HTML here without a browser stylesheet loader.
registerHooks({
  load(url, context, nextLoad) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : nextLoad(url, context);
  },
});
const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  jsx: { runtime: 'automatic' },
});
for (const file of [
  '../../components/problem-bank/problem-rich-text.tsx',
  '../../apps/native/src/components/problem-bank/problem-rich-text.tsx',
]) {
  const { renderProblemRichTextHtml: render } = await jiti.import(file);
  if (file.includes('/apps/native/')) {
    const stem = '给定以下 Python 代码：';
    for (const value of ["['a']", "['a', 'c']", "['c', 'a']", "{1: ['a', 'c']}"]) {
      const html = render(value, stem);
      assert.match(html, /<code /);
      assert.match(html, /problem-rich-code-token-string/);
    }
    for (const prose of ['顺序无法确定', 'The order cannot be determined', 'Selection Sort']) {
      assert.doesNotMatch(render(prose, stem), /<code/);
    }
    for (const markdown of [
      '`len(s)`',
      '~~~text\nhello\n~~~',
      '$x^2$',
      '[help](https://example.com)',
    ]) {
      assert.equal(render(markdown, stem), render(markdown));
    }
    assert.doesNotMatch(render('42', 'What is six times seven?'), /<code/);
    assert.match(
      render('for x in xs:\n    print(x)', stem),
      /class="language-python"[\s\S]*\n    /,
    );
    assert.doesNotMatch(render('["<script>"]', stem), /<script>/);
  }
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
  assert.match(render('Find $x \\rightarrow 0$.'), /→/);
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
