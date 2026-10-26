import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { createJiti } from 'jiti';
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const bank = await jiti.import('../../lib/problem-bank/index.ts');
function load(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) =>
      id in mocks
        ? mocks[id]
        : id.startsWith('@/') || id.startsWith('./') || id.startsWith('../')
          ? {}
          : require(id),
    mod,
    mod.exports,
  );
  return mod.exports;
}
const parser = load('lib/server/notebook-problems/import.core.drafts.ts', {
  '@/lib/problem-bank': bank,
});
const imports = load('lib/server/notebook-problems/import.multipart.ts', {
  './import.core.drafts': parser,
});
const evaluator = load('lib/server/notebook-problems/evaluate.ts', {
  '@/lib/problem-bank': bank,
  '@/lib/problem-bank/scoring-policy': await jiti.import(
    '../../lib/problem-bank/scoring-policy.ts',
  ),
  '@/lib/problem-bank/numeric-answer': await jiti.import(
    '../../lib/problem-bank/numeric-answer.ts',
  ),
});
const localGrading = load('apps/native/src/data/local-problem-grading.ts');
const localParts = load('apps/native/src/data/multipart-problem.ts', {
  './local-problem-grading': localGrading,
});
const solution = load('apps/native/src/lib/problem-solution.ts', {
  '../data/local-problem-grading': localGrading,
});
const snapshot = load('apps/native/src/data/problem-learning-snapshot.ts');
const fixture = {
  id: 'parent',
  title: 'Two tasks',
  type: 'multipart',
  points: 100,
  courseId: 'course',
  tags: [],
  publicContent: {
    type: 'multipart',
    stem: 'Use the same setup.',
    translations: { 'zh-CN': { stem: '使用共同条件。' } },
    parts: [
      {
        label: 'a',
        points: 4,
        content: {
          type: 'choice',
          stem: 'Select two.',
          selectionMode: 'single',
          options: [
            { id: 'x', label: 'One' },
            { id: 'y', label: 'Two' },
          ],
          translations: {
            'zh-CN': {
              stem: '选择二。',
              options: [
                { id: 'x', label: '一' },
                { id: 'y', label: '二' },
              ],
            },
          },
        },
      },
      {
        label: 'b',
        points: 6,
        dependsOn: ['a'],
        content: {
          type: 'calculation',
          stem: 'Compute six.',
          translations: { 'zh-CN': { stem: '计算六。' } },
        },
      },
    ],
  },
  grading: {
    type: 'multipart',
    graderKind: 'per_part',
    parts: [
      { label: 'a', grading: { type: 'choice', correctOptionIds: ['y'] } },
      { label: 'b', grading: { type: 'calculation', referenceAnswer: '6', acceptedForms: ['6'] } },
    ],
  },
};
function draft(label, stem, extra = {}) {
  return {
    draftId: label,
    title: 'Question ' + label,
    type: 'proof',
    points: 10,
    status: 'draft',
    source: 'manual',
    difficulty: 'medium',
    publicContent: { type: 'proof', stem },
    grading: { type: 'proof', referenceProof: 'Reason ' + label },
    sourceMeta: { structure: { topLevelLabel: label } },
    tags: [],
    validationErrors: [],
    ...extra,
  };
}
test('import groups a shared top-level number without merging different source questions', () => {
  const shared = 'A common setup with necessary definitions. '.repeat(5) + '\n\n';
  const a = draft('3(a)', shared + 'Prove A.');
  const b = draft('3(b)', shared + 'Prove B.');
  a.publicContent.translations = { 'zh-CN': { stem: '共同背景。'.repeat(30) + '\n\n证明甲。' } };
  b.publicContent.translations = { 'zh-CN': { stem: '共同背景。'.repeat(30) + '\n\n证明乙。' } };
  const result = imports.restructureMultipartDrafts([a, b]);
  assert.equal(result.drafts.length, 1);
  const q = result.drafts[0];
  assert.equal(q.type, 'multipart');
  assert.equal(q.publicContent.parts.length, 2);
  assert.equal(q.publicContent.parts[1].content.stem, 'Prove B.');
  assert.equal(q.grading.parts[0].grading.referenceProof, 'Reason 3(a)');
  assert.equal(
    bank.getLocalizedProblemContent(q.publicContent, 'zh-CN').parts[1].content.stem,
    '证明乙。',
  );
  assert.equal(
    imports.mergeSplitPartDrafts([draft('3', shared + 'A'), draft('4', shared + 'B')]).drafts
      .length,
    2,
  );
  assert.equal(
    imports.mergeSplitPartDrafts([
      { ...a, sourceMeta: { ...a.sourceMeta, mockPaper: 'A' } },
      { ...b, sourceMeta: { ...b.sourceMeta, mockPaper: 'B' } },
    ]).drafts.length,
    2,
  );
});
test('crammed bold subparts work with or without a shared preamble and preserve grading as pending', () => {
  for (const prefix of ['Shared givens.\n\n', '']) {
    const q = imports.splitCrammedPartDraft(
      draft('7', prefix + '**(a) (4 points)** Prove A.\n\n**(b) (6 points)** Prove B.'),
    );
    assert(q);
    assert(q.publicContent.stem.trim());
    assert.deepEqual(
      q.publicContent.parts.map((p) => p.label),
      ['a', 'b'],
    );
    assert(!q.publicContent.parts[0].content.stem.includes('**'));
    assert.equal(q.grading.parts[0].grading.referenceProof, undefined);
    assert.match(q.grading.analysis, /Reason 7/);
  }
});
test('server grading submits one part at a time and preserves other parts and score weights', async () => {
  const first = await evaluator.evaluateNotebookMultipartProblem({
    problem: fixture,
    answer: { parts: { a: { selectedOptionIds: ['y'] } } },
    language: 'en-US',
  });
  assert.equal(first.score, 40);
  assert.equal(first.result.parts[1].status, 'pending');
  assert.equal(first.result.parts[0].submissions, 1);
  const second = await evaluator.evaluateNotebookMultipartProblem({
    problem: fixture,
    answer: { parts: { b: { text: '6' } } },
    previous: first,
    language: 'en-US',
  });
  assert.equal(second.score, 100);
  assert.equal(second.status, 'passed');
  assert.equal(second.result.parts[0].submissions, 1);
  assert.deepEqual(second.answer.parts.a, { selectedOptionIds: ['y'] });
  const wrong = await evaluator.evaluateNotebookMultipartProblem({
    problem: fixture,
    answer: { parts: { a: { selectedOptionIds: ['x'] } } },
    language: 'en-US',
  });
  const retry = await evaluator.evaluateNotebookMultipartProblem({
    problem: fixture,
    answer: { parts: { a: { selectedOptionIds: ['y'] } } },
    previous: wrong,
    language: 'en-US',
  });
  assert.equal(retry.score, 24);
  assert.equal(retry.result.parts[0].submissions, 2);
  assert.equal(retry.result.parts[1].submissions, 0);
  const unknown = await evaluator.evaluateNotebookMultipartProblem({
    problem: fixture,
    answer: { parts: { unknown: { text: '6' } } },
    language: 'en-US',
  });
  assert.equal(unknown.status, 'error');
});
test('native parts, translation, references and reset snapshots preserve identifiers and earlier results', () => {
  const translated = bank.getLocalizedProblemContent(fixture.publicContent, 'zh-CN');
  assert.equal(translated.stem, '使用共同条件。');
  assert.equal(translated.parts[0].content.options[1].label, '二');
  assert.deepEqual(
    translated.parts.map((p) => p.label),
    ['a', 'b'],
  );
  assert.equal(fixture.publicContent.parts[0].content.stem, 'Select two.');
  const parts = localParts.multipartParts({ ...fixture, publicContent: translated });
  assert.deepEqual(localParts.partShares(parts), [0.4, 0.6]);
  assert.match(localParts.partQuestionText({ ...fixture, publicContent: translated }, 1), /选择二/);
  assert.equal(
    localParts.gradeLocalPart(fixture, parts[0], { selectedOptionIds: ['y'] }).status,
    'passed',
  );
  const reference = solution.problemSolution(fixture);
  assert.match(reference.answer, /\(a\)/);
  assert.match(reference.answer, /Two/);
  assert.match(reference.answer, /6/);
  assert.deepEqual(localGrading.emptyAnswerForProblem(fixture), { kind: 'parts', parts: {} });
  const answer = {
    kind: 'parts',
    parts: { a: { selectedOptionIds: ['x'] }, b: { text: 'unfinished' } },
  };
  const saved = snapshot.problemLearningArchive({
    problem: fixture,
    answer,
    progress: null,
    event: 'solution_viewed',
    at: 100,
    id: 'snapshot',
  });
  assert.deepEqual(saved.attempt.answer, answer);
  assert.match(saved.archive.studyMemories[0].text, /unfinished/);
  assert.deepEqual(saved.archive.problemProgress, []);
});
test('reviewed repair previews, updates in place, rejects stale data and never rewrites learner history', async () => {
  const helpers = await jiti.import('../../lib/server/admin-course-problem-upload.ts');
  const { repairCourseMultipart, MultipartRepairConflict } = await jiti.import(
    '../../lib/server/course-problem-multipart.ts',
  );
  let row = {
    id: 'parent',
    courseId: 'course',
    title: 'Old bundle',
    type: 'proof',
    status: 'published',
    difficulty: 'medium',
    ownerId: null,
    points: 100,
    publicContentJson: { type: 'proof', stem: '(a) First\n\n(b) Second' },
    gradingJson: { type: 'proof', referenceProof: 'Both answers' },
    sourceMeta: { sourceFile: 'exam.pdf' },
    updatedAt: new Date('2026-01-01'),
  };
  let writes = 0,
    versions = 0;
  const tx = {
    notebookProblem: {
      findMany: async () => [row],
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, 'parent');
        writes++;
        row = { ...row, ...data, updatedAt: new Date('2026-01-02') };
        return { count: 1 };
      },
    },
    course: {
      update: async () => {
        versions++;
      },
    },
  };
  const db = { $transaction: async (fn) => fn(tx) };
  const input = {
    reviewHash: 'f'.repeat(64),
    changes: [
      {
        id: 'parent',
        expectedRevision: helpers.courseProblemRevision(row),
        publicContent: fixture.publicContent,
        grading: fixture.grading,
      },
    ],
  };
  assert.equal((await repairCourseMultipart(db, 'course', input)).mode, 'preview');
  assert.equal(writes, 0);
  await assert.rejects(
    () =>
      repairCourseMultipart(db, 'course', {
        ...input,
        changes: [{ ...input.changes[0], expectedRevision: '0'.repeat(64) }],
      }),
    MultipartRepairConflict,
  );
  const applied = await repairCourseMultipart(db, 'course', { ...input, apply: true });
  assert.equal(applied.updated, 1);
  assert.equal(writes, 1);
  assert.equal(versions, 1);
  assert.equal(row.sourceMeta.sourceFile, 'exam.pdf');
  assert.equal(row.id, 'parent');
  assert.equal((await repairCourseMultipart(db, 'course', { ...input, apply: true })).unchanged, 1);
  assert.equal(writes, 1);
  await assert.rejects(() =>
    repairCourseMultipart(db, 'course', {
      ...input,
      changes: [
        {
          ...input.changes[0],
          publicContent: {
            ...fixture.publicContent,
            parts: [fixture.publicContent.parts[0], fixture.publicContent.parts[0]],
          },
        },
      ],
    }),
  );
});
