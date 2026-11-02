import assert from 'node:assert/strict';
import test from 'node:test';
import { codeStatementPresentation } from '../../lib/problem-bank/code-statement-presentation.ts';

test('Racket exam rules move below the task while trailing task notes stay in the description', () => {
  const content = {
    language: 'racket',
    stem: [
      'Design highest-margin.\n\n- Return the largest margin.',
      'Your function design must include an @htdf tag and appropriate tests.',
      'This problem will be autograded. NOTE that all of the following are required.',
      '- You must not edit the @htdf tag.\n* You must follow all applicable design rules.',
      'For an empty list, produce 0.',
    ].join('\n\n'),
  };
  const before = structuredClone(content);
  const result = codeStatementPresentation(content, 'en-US');
  assert.match(result.stem, /Return the largest margin/);
  assert.match(result.stem, /For an empty list, produce 0/);
  assert.doesNotMatch(result.stem, /autograded|design must include|must not edit/);
  assert.equal(result.constraints.length, 4);
  assert.match(result.constraints.join('\n'), /appropriate tests/);
  assert.match(result.constraints.join('\n'), /must not edit the @htdf/);
  assert.deepEqual(content, before);
  assert.equal(
    codeStatementPresentation({ ...content, language: 'python' }, 'en-US').stem,
    content.stem,
  );
});

test('Racket constraint examples stay with their rule and later explanatory figures stay in the task', () => {
  const invalid = '```racket\n(define (foo x) (empty? (filter ...)))\n```';
  const valid = '```racket\n(define (foo x) (foldr ...))\n```';
  const result = codeStatementPresentation(
    {
      language: 'racket',
      stem: [
        'Design ray-star.',
        'NOTE: This problem will be autograded.',
        '- The result must come from an abstract function. This would not be a valid function body:',
        invalid,
        'This would be a valid function body:',
        valid,
        'The explanation is attached as an image.',
      ].join('\n\n'),
    },
    'en-US',
  );
  assert.ok(result.constraints[1].includes(invalid));
  assert.ok(result.constraints[1].includes(valid));
  assert.match(result.stem, /explanation is attached/);
  assert.doesNotMatch(result.stem, /filter|foldr/);
});

test('a supplied data definition after grading rules remains in the Racket task', () => {
  const code = '```racket\n(@htdd Foo)\n(define-struct bar (x y))\n```';
  const result = codeStatementPresentation(
    {
      language: 'racket',
      stem: [
        'Complete the data definition.',
        'Note that this problem will be autograded. Failure may result in 0 marks.',
        '- You must not comment out the @htdd tag.',
        code,
      ].join('\n\n'),
    },
    'en-US',
  );
  assert.ok(result.stem.includes(code));
  assert.doesNotMatch(result.stem, /autograded/);
  assert.equal(result.constraints.length, 2);
});

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

test('bilingual grading notices and mixed bullet markers leave later task code intact', () => {
  for (const [notice, run, edit, task] of [
    [
      'NOTE: This problem will be autograded, and ALL OF THE FOLLOWING ARE ESSENTIAL IN YOUR SOLUTION.',
      'The file MUST NOT have any errors when the Run button is pressed. Press Run often.',
      'You MUST NOT edit any part of the file above the line marked with \\*\\*\\*.',
      'Write one step per row.',
    ],
    [
      '注意：本题采用自动评分，以下要求全部必须满足，否则可能得 0 分。',
      '点击 Run（运行）时，文件不得存在任何错误。请经常运行。',
      '不得修改标有 *** 的行上方的任何内容。',
      '每行填写一步。',
    ],
  ]) {
    const program = '```racket\n(define A 7)\n(+ A 1)\n```';
    const source = `Evaluate the expression.\n\n${notice}\n\n- ${run}\n* ${edit}\n\n${program}\n\n${task}`;
    const result = codeStatementPresentation({ language: 'racket', stem: source }, 'en-US');
    assert.equal(result.constraints.length, 3);
    assert(result.constraints.includes(run));
    assert(result.constraints.includes(edit));
    assert(result.stem.includes(program));
    assert(result.stem.includes(task));
    assert(!result.stem.includes(notice));
  }
});

test('grading notice variants and standalone restrictions are recognized', () => {
  for (const notice of [
    'Note that: - this problem will be autograded - you must not comment out tags.',
    'This problem with be autograded. Failure may result in 0 marks.',
    'NOTE: This question will be entirely autograded, your file must run without errors.',
    'This problem will be substantially autograded.',
    'Your submission must pass the Check Syntax button.',
  ]) {
    const result = codeStatementPresentation(
      { language: 'racket', stem: `Design f.\n\n${notice}` },
      'en-US',
    );
    assert.equal(result.stem, 'Design f.');
    assert.deepEqual(result.constraints, [notice]);
  }
});

test('Racket code already supplied in the editor is not repeated under an empty code heading', () => {
  const code = '(define-struct status (days))\n;; supplied data\n(define S (make-status 1))';
  const content = {
    language: 'racket',
    starterCode: `(require spd/tags)\n${code}\n`,
    stem: `Complete the data template and the delivery predicate.\n\n### Provided code\n\n\`\`\`racket\n${code}\n\`\`\``,
  };
  const result = codeStatementPresentation(content, 'en-US');
  assert.equal(result.stem, 'Complete the data template and the delivery predicate.');
  assert.equal(content.starterCode, `(require spd/tags)\n${code}\n`);
});
