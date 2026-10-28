import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import path from 'node:path';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const { countCorrectBlankAnswers } = await jiti.import(
  '../../lib/problem-bank/blank-answer-variants.ts',
);
const { emptyAnswerForProblem, answerHasContent, gradeLocalProblem } = await jiti.import(
  '../../apps/native/src/data/local-problem-grading.ts',
);
const { problemContentReadinessErrors } = await jiti.import(
  '../../lib/problem-bank/content-readiness.ts',
);
const { notebookProblemPublicContentSchema, notebookProblemGradingSchema } = await jiti.import(
  '../../lib/problem-bank/schema.ts',
);
const variants = [
  { variable: 'id20', first: 'id1', second: 'id2' },
  { variable: 'id21', first: 'id2', second: 'id1' },
];
const grading = {
  type: 'fill_blank',
  graderKind: 'blank_match',
  answerVariants: variants,
  blanks: Object.keys(variants[0]).map((id) => ({
    id,
    acceptedAnswers: variants.map((v) => v[id]),
    matcher: 'normalized_exact',
    caseSensitive: false,
  })),
};
const publicContent = {
  type: 'fill_blank',
  blankLayout: 'figure',
  stemTemplate: 'Fill the numbered source figure.',
  blanks: grading.blanks.map(({ id }) => ({ id, answerKind: 'text' })),
  assets: { images: [{ id: 'diagram', src: '/diagram.png', role: 'question' }] },
};
const problem = { type: 'fill_blank', publicContent, grading };
const matches = (_blank, actual, expected) =>
  actual.trim().toLowerCase() === expected.toLowerCase();

test('both coherent diagrams pass; independently valid but mixed IDs do not', () => {
  for (const filled of variants)
    assert.equal(countCorrectBlankAnswers(grading, filled, matches), 3);
  assert.ok(
    countCorrectBlankAnswers(grading, { variable: 'id20', first: 'id2', second: 'id1' }, matches) <
      3,
  );
  assert.equal(countCorrectBlankAnswers(grading, {}, matches), 0);
});
test('ordinary blanks retain independent accepted answers', () => {
  assert.equal(
    countCorrectBlankAnswers(
      { blanks: grading.blanks },
      { variable: 'id20', first: 'id2', second: 'id1' },
      matches,
    ),
    3,
  );
});
test('native blanks initialize and grade as structured fields', () => {
  const empty = emptyAnswerForProblem(problem);
  assert.deepEqual(empty, { kind: 'blanks', blanks: {} });
  assert.equal(answerHasContent(empty), false);
  assert.equal(answerHasContent({ kind: 'blanks', blanks: { variable: 'id20' } }), true);
  for (const blanks of variants)
    assert.equal(gradeLocalProblem(problem, { kind: 'blanks', blanks }).status, 'passed');
  assert.notEqual(
    gradeLocalProblem(problem, {
      kind: 'blanks',
      blanks: { variable: 'id20', first: 'id2', second: 'id1' },
    }).status,
    'passed',
  );
});
test('figure blanks require an image and complete alternative answer sets', () => {
  assert.equal(notebookProblemPublicContentSchema.safeParse(publicContent).success, true);
  assert.equal(notebookProblemGradingSchema.safeParse(grading).success, true);
  const draft = { ...problem, points: 100 };
  assert.deepEqual(problemContentReadinessErrors(draft), []);
  assert.ok(
    problemContentReadinessErrors({
      ...draft,
      publicContent: { ...publicContent, assets: { images: [] } },
    }).length,
  );
  assert.ok(
    problemContentReadinessErrors({
      ...draft,
      grading: { ...grading, answerVariants: [{ variable: 'id20' }] },
    }).length,
  );
});

test('larger memory diagrams retain all 18 answer boxes in one question', () => {
  const blanks = Array.from({ length: 18 }, (_, i) => ({
    id: `memory-${i + 1}`,
    answerKind: 'text',
  }));
  assert.equal(
    notebookProblemPublicContentSchema.safeParse({ ...publicContent, blanks }).success,
    true,
  );
  assert.equal(
    notebookProblemGradingSchema.safeParse({
      ...grading,
      blanks: blanks.map(({ id }) => ({ id, acceptedAnswers: ['id1'] })),
      answerVariants: undefined,
    }).success,
    true,
  );
});
