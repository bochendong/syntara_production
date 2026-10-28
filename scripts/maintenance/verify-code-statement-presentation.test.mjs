import assert from 'node:assert/strict';
import test from 'node:test';
import { codeStatementPresentation } from '../../lib/problem-bank/code-statement-presentation.ts';

test('docstring tasks show one description, retaining concrete implementation restrictions', () => {
  const given =
    'def select(values):\n    """Return qualifying values.\n    >>> select([])\n    []\n    """';
  const stem = `Complete the function using an index-based loop.\n\n\`\`\`python\n${given}\n\`\`\``;
  const content = {
    stem,
    template: `${given}\n    {{body}}`,
    statementSections: [
      { id: 'task', kind: 'overview', title: 'Task', body: stem },
      {
        id: 'interface',
        kind: 'interface',
        title: 'Interface',
        body: 'The editable starter contains the required interface. All functions in this question are submitted together.',
      },
      {
        id: 'examples',
        kind: 'examples',
        title: 'Examples',
        body: 'Verified examples are shown below.',
      },
    ],
    constraints: [
      'Use only the introductory Python constructs allowed in the statement.',
      'Do not use sets.',
    ],
    sampleIO: [{ input: 'select([])', output: '[]' }],
    starterCodeDescription:
      'Complete only the editable blanks. Preserve the supplied headers and documentation.',
  };
  const before = structuredClone(content);
  const result = codeStatementPresentation(content, 'zh-CN');
  assert.equal(result.sections.length, 1);
  assert.equal(result.stem, 'Complete the function using an index-based loop.');
  assert.deepEqual(result.constraints, ['Do not use sets.']);
  assert.deepEqual(result.samples, []);
  assert.equal(result.starterDescription, undefined);
  assert.deepEqual(content, before);
});

test('tasks requiring students to write their own docstring retain that requirement', () => {
  const result = codeStatementPresentation(
    {
      stem: 'Write a complete function: annotated header, description, two doctest examples, and a loop-based body.',
      template: '{{function}}',
      statementSections: [
        {
          id: 'requirements',
          title: 'What to implement',
          body: 'Write a complete function including the required course docstring.',
        },
      ],
      sampleIO: [{ input: 'choose([])', output: '[]' }],
    },
    'en-US',
  );
  assert.match(result.stem, /annotated header/);
  assert.match(result.stem, /two doctest examples/);
  assert.equal(result.sections.length, 0);
  assert.equal(result.samples.length, 1);
});

test('code and specific notes that are not present in the editor stay visible', () => {
  const stem = 'Trace this call:\n```python\nprint(choose([1, 2]))\n```';
  const result = codeStatementPresentation(
    {
      stem,
      starterCode: 'def choose(values):\n    pass',
      statementSections: [
        {
          id: 'rule',
          title: 'Rule',
          body: 'Do not mutate the input.',
          items: ['Use a while loop.'],
        },
      ],
    },
    'en-US',
  );
  assert.equal(result.stem, stem);
  assert.equal(result.sections[0].body, 'Do not mutate the input.');
  assert.deepEqual(result.sections[0].items, ['Use a while loop.']);
});
