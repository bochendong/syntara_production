import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';
import { Streamdown } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';

const jiti = createJiti(import.meta.url);
const { normalizeLectureMarkdownForRendering: normalize } = await jiti.import(
  '../../lib/markdown/lecture-markdown.ts',
);
const math = createMathPlugin({ singleDollarTextMath: true });
const render = (markdown) =>
  renderToStaticMarkup(
    React.createElement(
      Streamdown,
      { mode: 'static', parseIncompleteMarkdown: false, plugins: { math } },
      normalize(markdown),
    ),
  );

test('inverse-function list renders bold questions containing inline math', () => {
  const source = String.raw`1. **$f$ 是否可逆？ **不可逆，因为 $f(-1)=3=f(4)$。
2. **$g$ 是否可逆？ **可逆。
3. **$g^{-1}$ 的定义域是什么？ **反函数的定义域是 $g$ 的值域。
4. **求 $g^{-1}(2)$。 **查表可见 $g(3)=2$。
5. **求 $g(g^{-1}(5))$。 **由表知 $g(0)=5$。`;
  const html = render(source);
  assert.equal((html.match(/data-streamdown="strong"/g) ?? []).length, 5);
  assert.ok(!html.includes('**'));
  assert.ok(!html.includes('katex-error'));
  assert.ok(html.includes('katex'));
  assert.equal(normalize(normalize(source)), normalize(source));
});

test('standalone tagged sum renders as a display equation with its number', () => {
  const html = render(String.raw`考虑表达式

$$\sum_{i=n}^{m}r_i \tag{1}$$

读作 $i$ 从 $n$ 到 $m$ 的 $r_i$ 之和。`);
  assert.ok(html.includes('katex-display'));
  assert.ok(html.includes('class="tag"'));
  assert.ok(html.includes('(1)'));
  assert.ok(!html.includes('katex-error'));
});

test('normalization preserves existing math, code, literal markers and valid emphasis', () => {
  const unchanged = [
    '**正常加粗** 和 ***强调***，$x$ 与 $$x$$ 保持行内原样。',
    String.raw`\*\* literal ** text **`,
    '`** spaced **` and ``code ` ** spaced **``',
    '$\\text{** spaced **}$',
    '    ** spaced **\n    $$x \\tag{1}$$',
    '\t** spaced **',
    '```markdown\n** spaced **\n$$x \\tag{1}$$\n```',
    '~~~~\n```\n** spaced **\n~~~~',
    '<pre>\n** spaced **\n$$x \\tag{1}$$\n</pre>',
    '<code>** spaced **</code>',
    '$$\n\\text{** spaced **}\n\\tag{1}\n$$',
    '**unclosed marker',
  ];
  for (const source of unchanged) assert.equal(normalize(source), source, source);
});

test('keeps list structure, following paragraphs and idempotent display normalization', () => {
  const source = '1. **  Question?  **Answer\n\n  $$x^2\\tag{2}$$\n\nNext paragraph';
  const result = normalize(source);
  assert.equal(result, '1.   **Question?**  Answer\n\n  $$\n  x^2\\tag{2}\n  $$\n\nNext paragraph');
  assert.equal(normalize(result), result);
  const html = render(result);
  assert.ok(html.includes('<ol'));
  assert.ok(html.includes('Next paragraph'));
  assert.ok(!html.includes('katex-error'));
});
