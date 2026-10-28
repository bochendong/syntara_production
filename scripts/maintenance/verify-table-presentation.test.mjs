import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { tableSetupNeedsDisplay } = await jiti.import('../../lib/problem-bank/table-problem.ts');
test('setup shown in the statement is not duplicated beside the answer table', () => {
  const code = 'def f(x):\n    return x';
  assert.equal(
    tableSetupNeedsDisplay({
      stem: 'Read the code.\n```python\n' + code + '\n```',
      setupCode: code,
    }),
    false,
  );
  assert.equal(
    tableSetupNeedsDisplay({
      stem: 'Read the code.\n```python\na = 1\n```\n\n```python\nb = 2\n```',
      setupCode: 'a = 1\n\nb = 2',
    }),
    false,
  );
  assert.equal(tableSetupNeedsDisplay({ stem: 'Read the code.', setupCode: code }), true);
  assert.equal(tableSetupNeedsDisplay({ stem: 'Read the code.' }), false);
});
