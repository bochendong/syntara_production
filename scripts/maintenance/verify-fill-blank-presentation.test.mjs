import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { fillBlankPrompt } = await jiti.import('../../lib/problem-bank/fill-blank-presentation.ts');

test('numbered blanks use the input order, not id suffixes or occurrence order', () => {
  assert.equal(
    fillBlankPrompt('| A | {{ second }} |\n| B | {{first}} |', ['first', 'second']),
    '| A | [2] ____ |\n| B | [1] ____ |',
  );
});
test('code blanks remain plain code text without Markdown formatting tokens', () => {
  assert.equal(
    fillBlankPrompt('```python\nx = L.pop({{index}})\n```', ['index']),
    '```python\nx = L.pop([1] ____)\n```',
  );
});
test('repeated references keep their number; unknown markers never leak internal ids', () => {
  assert.equal(fillBlankPrompt('{{x}} / {{x}} / {{missing}}', ['x']), '[1] ____ / [1] ____ / ____');
});
test('source diagrams with numbered fields retain their original description', () => {
  const prompt = 'Fill the 18 numbered boxes in the original diagram.';
  assert.equal(fillBlankPrompt(prompt, ['box-1']), prompt);
});
