import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { courseProblemRevision } = await jiti.import(
  '../../lib/server/admin-course-problem-upload.ts',
);
const { reviseCourseProblems, CourseProblemRevisionConflict } = await jiti.import(
  '../../lib/server/course-problem-revisions.ts',
);

const { memoryDiagramQuestionView } = await jiti.import('../../lib/problem-bank/memory-diagram.ts');
const row = (id, type = 'short_answer') => ({
  id,
  courseId: 'course',
  ownerId: null,
  title: id,
  status: 'published',
  type,
  difficulty: 'medium',
  updatedAt: new Date('2026-11-20T00:00:00.000Z'),
  publicContentJson: { type, stem: 'Original prompt' },
  gradingJson: { type, referenceAnswer: 'Original answer' },
  sourceMeta: { paper: 'original' },
});
const target = (problem) => ({
  id: problem.id,
  expectedRevision: courseProblemRevision(problem),
});
const options = [
  { id: 'a', label: 'First' },
  { id: 'b', label: 'Second' },
];
const convert = (problem) => ({
  ...target(problem),
  action: 'convert-to-choice',
  publicContent: {
    type: 'choice',
    stem: 'Choose one',
    selectionMode: 'single',
    options,
    translations: {
      'en-US': { stem: 'Choose one', options },
      'zh-CN': { stem: '请选择一项', options },
    },
  },
  grading: { type: 'choice', graderKind: 'exact_choice', correctOptionIds: ['b'] },
});

function fixture(...rows) {
  let version = 1;
  const state = new Map(rows.map((item) => [item.id, structuredClone(item)]));
  return {
    state,
    version: () => version,
    db: {
      async $transaction(work) {
        const next = structuredClone(state);
        let revision = version;
        const result = await work({
          notebookProblem: {
            findMany: async ({ where }) =>
              [...next.values()].filter(
                (p) =>
                  p.ownerId === where.ownerId &&
                  p.courseId === where.courseId &&
                  where.id.in.includes(p.id),
              ),
            updateMany: async ({ where, data }) => {
              const p = next.get(where.id);
              assert.equal(p.courseId, where.courseId);
              assert.equal(p.status, where.status);
              assert.deepEqual(p.updatedAt, where.updatedAt);
              next.set(p.id, { ...p, ...data, updatedAt: new Date('2026-11-22T00:00:00.000Z') });
              return { count: 1 };
            },
          },
          course: {
            update: async ({ data }) => {
              revision += data.contentVersion.increment;
            },
          },
        });
        for (const [id, item] of next) state.set(id, item);
        version = revision;
        return result;
      },
    },
  };
}

test('previews then converts, archives and updates presentation on the same question IDs', async () => {
  const original = row('convert');
  const proof = row('proof', 'proof');
  const code = row('display', 'code');
  code.publicContentJson.statementSections = [
    { id: 'requirements', code: 'for i in range(n):', codeLanguage: 'text' },
  ];
  const untouched = row('unrelated');
  const { state, db, version } = fixture(original, proof, code, untouched);
  const input = {
    changes: [
      convert(original),
      { ...target(proof), action: 'archive' },
      {
        ...target(code),
        action: 'display',
        sections: [{ id: 'requirements', codeLanguage: 'python' }],
      },
    ],
  };
  assert.equal((await reviseCourseProblems(db, 'course', input)).updated, 0);
  assert.equal(version(), 1);
  assert.deepEqual(state.get('convert'), original);

  assert.equal((await reviseCourseProblems(db, 'course', { ...input, apply: true })).updated, 3);
  assert.equal(version(), 2);
  assert.equal(state.get('convert').type, 'choice');
  assert.deepEqual(state.get('convert').sourceMeta, original.sourceMeta);
  assert.equal(state.get('proof').status, 'archived');
  assert.deepEqual(state.get('proof').gradingJson, proof.gradingJson);
  assert.equal(state.get('display').publicContentJson.statementSections[0].codeLanguage, 'python');
  assert.deepEqual(state.get('display').gradingJson, code.gradingJson);
  assert.deepEqual(state.get('unrelated'), untouched);
  assert.equal((await reviseCourseProblems(db, 'course', { ...input, apply: true })).unchanged, 3);
  assert.equal(version(), 2);
});

test('rejects stale, foreign and private questions as well as invalid option IDs', async () => {
  const question = row('question');
  const foreign = { ...row('foreign'), courseId: 'other' };
  const privateQuestion = { ...row('private'), ownerId: 'student' };
  const { db, version } = fixture(question, foreign, privateQuestion);
  const stale = { ...convert(question), expectedRevision: '0'.repeat(64) };
  const invalid = { ...convert(question), grading: { type: 'choice', correctOptionIds: ['x'] } };
  for (const proposal of [stale, invalid, convert(foreign), convert(privateQuestion)]) {
    await assert.rejects(
      reviseCourseProblems(db, 'course', { changes: [proposal], apply: true }),
      CourseProblemRevisionConflict,
    );
  }
  assert.equal(version(), 1);
});

test('patches bilingual multipart presentation without rewriting code, IDs or grading', async () => {
  const question = row('part', 'multipart');
  const code = {
    ...row('code', 'code').publicContentJson,
    starterCode: 'def f():\n    pass',
    statementSections: [
      { id: 'requirements', body: 'Pick a block.', code: 'A. return x', codeLanguage: 'python' },
    ],
    translations: { 'zh-CN': { stem: '原题题面' }, 'en-US': { stem: 'Original prompt' } },
  };
  question.publicContentJson.parts = [{ label: 'a', points: 2, content: code }];
  const path = ['parts', 0, 'content'];
  const change = {
    ...target(question),
    action: 'presentation',
    edits: [
      { path: [...path, 'translations', 'zh-CN', 'stem'], before: '原题题面', after: '中文题面' },
      {
        path: [...path, 'translations', 'en-US', 'stem'],
        before: 'Original prompt',
        after: 'English prompt',
      },
      {
        path: [...path, 'statementSections', 0, 'body'],
        before: 'Pick a block.',
        after: 'Pick a block.\n\nA. `return x`',
      },
      { path: [...path, 'statementSections', 0, 'code'], before: 'A. return x', after: null },
      { path: [...path, 'statementSections', 0, 'codeLanguage'], before: 'python', after: null },
    ],
  };
  const { state, db, version } = fixture(question);
  const input = { changes: [change] };
  assert.equal((await reviseCourseProblems(db, 'course', input)).updated, 0);
  assert.deepEqual(state.get(question.id), question);
  assert.equal((await reviseCourseProblems(db, 'course', { ...input, apply: true })).updated, 1);
  assert.equal(version(), 2);
  const after = state.get(question.id);
  assert.deepEqual(after.gradingJson, question.gradingJson);
  assert.deepEqual(after.publicContentJson.parts[0], {
    label: 'a',
    points: 2,
    content: {
      ...code,
      translations: { 'zh-CN': { stem: '中文题面' }, 'en-US': { stem: 'English prompt' } },
      statementSections: [{ id: 'requirements', body: 'Pick a block.\n\nA. `return x`' }],
    },
  });
  assert.equal((await reviseCourseProblems(db, 'course', { ...input, apply: true })).unchanged, 1);
});

test('rejects stale text and writes to executable, identity, or grading fields', async () => {
  const question = row('restricted', 'code');
  const { db, version } = fixture(question);
  for (const edit of [
    { path: ['stem'], before: 'Stale prompt', after: 'New prompt' },
    { path: ['starterCode'], before: 'pass', after: 'return x' },
    { path: ['options', 0, 'id'], before: 'a', after: 'b' },
    { path: ['grading', 'referenceAnswer'], before: 'Old answer', after: 'New answer' },
    { path: ['__proto__', 'stem'], before: 'Original prompt', after: 'New prompt' },
    { path: ['statementSections', 0, 'code'], before: 'return x', after: null },
  ]) {
    await assert.rejects(
      reviseCourseProblems(db, 'course', {
        apply: true,
        changes: [{ ...target(question), action: 'presentation', edits: [edit] }],
      }),
      CourseProblemRevisionConflict,
    );
  }
  assert.equal(version(), 1);
});

test('memory diagrams revise localized multipart presentation without touching grading', async () => {
  const question = row('memory', 'multipart');
  const stemTemplate = 'Fill the numbered image.';
  const translations = { 'en-US': { stemTemplate }, 'zh-CN': { stemTemplate: '按编号填图。' } };
  question.publicContentJson = {
    type: 'multipart',
    stem: 'Trace the code.',
    parts: [
      {
        label: 'a',
        points: 2,
        content: {
          type: 'fill_blank',
          stemTemplate,
          translations,
          blankLayout: 'figure',
          blanks: [{ id: 'variable', answerKind: 'text' }],
          assets: {
            images: [
              { id: 'figure', src: '/figure.png' },
              { id: 'other', src: '/other.png' },
            ],
          },
        },
      },
      { label: 'b', points: 3, content: { type: 'short_answer', stem: 'Explain.' } },
    ],
  };
  question.gradingJson = {
    type: 'multipart',
    parts: [
      {
        label: 'a',
        grading: { type: 'fill_blank', blanks: [{ id: 'variable', acceptedAnswers: ['id1'] }] },
      },
      { label: 'b', grading: { type: 'short_answer', referenceAnswer: 'Alias.' } },
    ],
  };
  const change = {
    ...target(question),
    action: 'memory-diagram',
    parts: [
      {
        label: 'a',
        content: {
          memoryDiagram: {
            variables: [{ name: 'a', reference: { blankId: 'variable' } }],
            objects: [{ id: 'id1', pythonType: 'list', value: [] }],
          },
          stemTemplate: 'Fill the diagram.',
          translations: {
            'en-US': { stemTemplate: 'Fill the diagram.' },
            'zh-CN': { stemTemplate: '补全内存图。' },
          },
          removeImages: ['figure'],
        },
      },
    ],
  };
  const { state, db, version } = fixture(question);
  const invalid = structuredClone(change);
  invalid.parts[0].content.memoryDiagram.variables[0].reference.blankId = 'unknown';
  await assert.rejects(
    reviseCourseProblems(db, 'course', { changes: [invalid], apply: true }),
    CourseProblemRevisionConflict,
  );
  assert.equal((await reviseCourseProblems(db, 'course', { changes: [change] })).updated, 0);
  assert.deepEqual(state.get(question.id), question);
  assert.equal(
    (await reviseCourseProblems(db, 'course', { changes: [change], apply: true })).updated,
    1,
  );
  const saved = state.get(question.id);
  assert.deepEqual(saved.gradingJson, question.gradingJson);
  assert.deepEqual(saved.publicContentJson.parts[1], question.publicContentJson.parts[1]);
  const updatedPart = saved.publicContentJson.parts[0];
  assert.equal(updatedPart.points, 2);
  assert.equal(updatedPart.content.blankLayout, 'figure');
  assert.deepEqual(updatedPart.content.assets, question.publicContentJson.parts[0].content.assets);
  assert.deepEqual(updatedPart.content.translations, translations);
  const shown = memoryDiagramQuestionView(updatedPart.content, 'zh-CN');
  assert.deepEqual(
    shown.content.assets.images.map((image) => image.id),
    ['other'],
  );
  assert.equal(shown.prompt, '补全内存图。');
  assert.equal(
    (await reviseCourseProblems(db, 'course', { changes: [change], apply: true })).unchanged,
    1,
  );
  assert.equal(version(), 2);
});
