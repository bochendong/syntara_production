// Offline transactional regression checks. No credentials or live course data are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const modules = new Map();
function load(path) {
  if (modules.has(path)) return modules.get(path);
  const mod = { exports: {} };
  modules.set(path, mod.exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === '@/lib/server/generated-prisma')
        return {
          Prisma: {
            sql: (strings, ...values) => ({ strings, values }),
            TransactionIsolationLevel: { Serializable: 'Serializable' },
          },
        };
      if (id === '@/lib/server/repositories/notebook-repository')
        return {
          refreshCourseSummaryFields: async (db, courseId) => {
            db.summaries.push(courseId);
            if (db.failSummary) throw new Error('injected failure after content writes');
          },
        };
      if (id === '@/lib/problem-bank') return load('lib/problem-bank/schema.ts');
      if (id.startsWith('@/')) return load(`${id.slice(2)}.ts`);
      return require(id);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}
const { copyCourseContents, getCourseBulkMovePreview } = load(
  'lib/server/teacher-course-bulk-move.ts',
);
const { groupBulkMoveCourses } = load('lib/teacher/course-bulk-move.ts');
const date = new Date('2026-09-14T12:00:00Z');

function fixture() {
  const course = (id, year, term, ownerId = 'teacher') => ({
    id,
    ownerId,
    name: id,
    courseCode: id === 'source' ? 'BUS200' : 'ECO101',
    academicYear: year,
    academicTerm: term,
    externalBinding: null,
  });
  const book = (id, courseId, extra = {}) => ({
    id,
    courseId,
    ownerId: 'teacher',
    name: id,
    sourceNotebookId: null,
    updatedAt: date,
    createdAt: date,
    coverSlideJson: { learningOrder: 1, custom: 'preserve' },
    removedAt: null,
    contentVersion: 4,
    ...extra,
  });
  const problem = (id, courseId, notebookId, extra = {}) => ({
    id,
    courseId,
    notebookId,
    chapterId: null,
    title: id,
    type: 'short_answer',
    updatedAt: date,
    publicContentJson: { type: 'short_answer', stem: `Explain ${id}` },
    order: 1,
    problemNumber: 1,
    status: 'published',
    gradingJson: { referenceAnswer: 'answer' },
    ...extra,
  });
  return {
    course: [
      course('source', 2026, 'fall'),
      course('target', 2025, 'winter'),
      course('private', 2027, 'fall', 'other'),
      {
        ...course('revoked', 2027, 'fall'),
        externalBinding: { memberships: [{ userId: 'teacher', role: 'TEACHER', active: false }] },
      },
      {
        ...course('co-teacher', 2027, 'winter', 'other'),
        externalBinding: { memberships: [{ userId: 'teacher', role: 'TEACHER', active: true }] },
      },
    ],
    scene: [
      {
        id: 'scene-copy',
        notebookId: 'book',
        title: 'Lecture',
        type: 'slide',
        order: 0,
        content: { text: 'lecture' },
      },
    ],
    notebookPageContent: [{ pageId: 'page', content: { text: 'content' } }],
    notebookPageActions: [],
    notebookPageAsset: [],
    notebookProblemSecret: [{ problemId: 'p1', secretJudgeJson: { secretTests: ['hidden'] } }],
    notebook: [
      book('book', 'source'),
      book('hidden', 'source', { removedAt: date }),
      book('target-book', 'target'),
      book('other-book', 'source', { ownerId: 'other' }),
    ],
    notebookProblem: [
      problem('p1', 'source', 'book', { chapterId: 'chapter' }),
      problem('legacy', null, 'book'),
      problem('standalone', 'source', null),
      problem('target-p', 'target', 'target-book'),
    ],
    markdownNotebookSection: [
      { id: 'section', notebookId: 'book', courseId: 'source', markdown: '# Notes' },
    ],
    notebookPage: [{ id: 'page', notebookId: 'book', courseId: 'source', imageUrl: '/image.png' }],
    courseProblemChapter: [
      {
        id: 'chapter',
        courseId: 'source',
        name: 'Chapter 1',
        position: 0,
        description: 'Description',
      },
    ],
    courseProblemTagNode: [
      {
        id: 'area',
        courseId: 'source',
        parentId: null,
        name: 'Area',
        normalizedName: 'area',
        level: 0,
        aliases: [],
        position: 0,
      },
      {
        id: 'concept',
        courseId: 'source',
        parentId: 'area',
        name: 'Concept',
        normalizedName: 'concept',
        level: 1,
        aliases: [],
        position: 0,
      },
    ],
    notebookProblemTagAssignment: [
      { problemId: 'p1', tagId: 'concept', source: 'teacher', status: 'applied', confidence: 1 },
    ],
    problemImportBatch: [{ id: 'batch', courseId: null, notebookId: 'book', status: 'committed' }],
    knowledgeDocument: [
      {
        id: 'doc',
        courseId: 'source',
        notebookId: 'book',
        sourceEntityType: 'MarkdownNotebookSection',
        sourceEntityId: 'section',
      },
      {
        id: 'p-doc',
        courseId: 'source',
        notebookId: 'book',
        sourceEntityType: 'NotebookProblem',
        sourceEntityId: 'p1',
      },
    ],
    agentTask: [],
    backgroundJob: [],
    attempts: [{ id: 'attempt', problemId: 'p1', score: 80, images: ['/answer.png'] }],
    scenes: [{ id: 'scene', notebookId: 'book', content: { text: 'lecture' } }],
  };
}

function database(initial) {
  let state = structuredClone(initial);
  const db = {
    summaries: [],
    failSummary: false,
    get state() {
      return state;
    },
  };
  function match(row, where) {
    if (!row) return false;
    return Object.entries(where ?? {}).every(([key, value]) => {
      if (key === 'OR') return value.some((part) => match(row, part));
      if (key === 'AND') return value.every((part) => match(row, part));
      if (key === 'notebook')
        return match(
          state.notebook.find((b) => b.id === row.notebookId),
          value,
        );
      if (key.includes('_')) return match(row, value); // Prisma compound unique keys
      const actual = row[key];
      if (value === null || typeof value !== 'object') return actual === value;
      if ('in' in value) return actual !== null && value.in.includes(actual);
      if ('notIn' in value) return actual !== null && !value.notIn.includes(actual);
      if ('not' in value) return actual !== null && actual !== value.not;
      if ('some' in value) return actual?.some((item) => match(item, value.some)) ?? false;
      return match(actual, value);
    });
  }
  let nextId = 0;
  function apply(row, data) {
    for (const [key, value] of Object.entries(data)) {
      row[key] =
        value && typeof value === 'object' && 'increment' in value
          ? row[key] + value.increment
          : value;
    }
    row.updatedAt = new Date(date.getTime() + 1);
    return structuredClone(row);
  }
  for (const model of Object.keys(initial)) {
    db[model] = {
      findMany: async ({ where, include } = {}) =>
        structuredClone(
          state[model]
            .filter((row) => match(row, where))
            .map((row) => {
              if (include && model === 'notebook')
                return {
                  ...row,
                  scenes: state.scene.filter((item) => item.notebookId === row.id),
                  markdownSections: state.markdownNotebookSection.filter(
                    (item) => item.notebookId === row.id,
                  ),
                  pages: state.notebookPage
                    .filter((item) => item.notebookId === row.id)
                    .map((page) => ({
                      ...page,
                      content: state.notebookPageContent.find((item) => item.pageId === page.id),
                      actions: state.notebookPageActions.find((item) => item.pageId === page.id),
                      assets: state.notebookPageAsset.filter((item) => item.pageId === page.id),
                    })),
                };
              if (include && model === 'notebookProblem')
                return {
                  ...row,
                  secret: state.notebookProblemSecret.find((item) => item.problemId === row.id),
                  tagAssignments: state.notebookProblemTagAssignment.filter(
                    (item) => item.problemId === row.id,
                  ),
                };
              return row;
            }),
        ),
      create: async ({ data }) => {
        const row = {
          id: `created-${nextId++}`,
          ...(model === 'notebook' ? { removedAt: null } : {}),
          ...data,
        };
        state[model].push(row);
        return structuredClone(row);
      },
      findFirst: async ({ where }) =>
        structuredClone(state[model].find((row) => match(row, where)) ?? null),
      count: async ({ where }) => state[model].filter((row) => match(row, where)).length,
      update: async ({ where, data }) => {
        const row = state[model].find((item) => match(item, where));
        assert.ok(row, `Missing ${model} ${JSON.stringify(where)}`);
        return apply(row, data);
      },
      updateMany: async ({ where, data }) => {
        const rows = state[model].filter((row) => match(row, where));
        rows.forEach((row) => apply(row, data));
        return { count: rows.length };
      },
      upsert: async ({ where, create, update }) => {
        const row = state[model].find((item) => match(item, where));
        if (row) return apply(row, update);
        const added = { id: `created-${nextId++}`, ...create };
        state[model].push(added);
        return structuredClone(added);
      },
      deleteMany: async ({ where }) => {
        state[model] = state[model].filter((row) => !match(row, where));
      },
    };
  }
  db.$queryRaw = async () => [];
  db.$queryRawUnsafe = async () => [];
  db.$transaction = async (run, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    const snapshot = structuredClone(state);
    try {
      return await run(db);
    } catch (error) {
      state = snapshot;
      throw error;
    }
  };
  return db;
}
async function inputFor(db, notebooks, problems) {
  const preview = await getCourseBulkMovePreview(db, 'teacher', 'source');
  assert.deepEqual(preview.targets.map((c) => c.id).sort(), ['co-teacher', 'target']);
  return {
    targetCourseId: 'target',
    notebooks,
    problems,
    notebookVersion: preview.notebooks.version,
    problemVersion: preview.problems.version,
  };
}

let checks = 0;
for (const [notebooks, problems] of [
  [true, false],
  [false, true],
  [true, true],
]) {
  const original = fixture();
  const db = database(original);
  const input = await inputFor(db, notebooks, problems);
  const result = await copyCourseContents(db, 'teacher', 'source', input);
  assert.deepEqual(result, {
    notebooks: notebooks ? 1 : 0,
    problems: problems ? 3 : 0,
    targetCourseId: 'target',
  });
  for (const [model, rows] of Object.entries(original)) {
    for (const row of rows) {
      assert.deepEqual(
        db.state[model].find((item) => item.id === row.id),
        row,
        `Copy must preserve every original ${model} row`,
      );
    }
  }
  assert.equal(db.state.notebook.length - original.notebook.length, notebooks ? 1 : 0);
  assert.equal(db.state.notebookProblem.length - original.notebookProblem.length, problems ? 3 : 0);
  assert.deepEqual(db.summaries, ['target']);
  const copied = structuredClone(db.state);
  await assert.rejects(copyCourseContents(db, 'teacher', 'source', input), /重复|已有/);
  assert.deepEqual(db.state, copied);
  checks++;
}

for (const scenario of [
  'move-rejected',
  'unauthorized-target',
  'revoked-target',
  'unauthorized-source',
  'same-course',
  'empty-selection',
  'stale',
  'duplicate',
  'invalid',
  'active-job',
  'active-task',
  'committing',
  'rollback',
  'taxonomy-conflict',
]) {
  const db = database(fixture());
  const input = await inputFor(db, true, true);
  let source = 'source';
  if (scenario === 'move-rejected') input.operation = 'move';
  if (scenario === 'unauthorized-target') input.targetCourseId = 'private';
  if (scenario === 'revoked-target') input.targetCourseId = 'revoked';
  if (scenario === 'unauthorized-source') source = 'private';
  if (scenario === 'same-course') input.targetCourseId = 'source';
  if (scenario === 'empty-selection') {
    input.notebooks = false;
    input.problems = false;
  }
  if (scenario === 'stale') db.state.notebookProblem[0].updatedAt = new Date(date.getTime() + 100);
  if (scenario === 'duplicate') {
    db.state.notebookProblem.at(-1).publicContentJson =
      db.state.notebookProblem[0].publicContentJson;
    db.state.notebookProblem.at(-1).title = db.state.notebookProblem[0].title;
  }
  if (scenario === 'invalid') db.state.notebookProblem[0].publicContentJson = {};
  if (scenario === 'active-job')
    db.state.backgroundJob.push({ id: 'job', courseId: 'source', status: 'running' });
  if (scenario === 'active-task')
    db.state.agentTask.push({
      id: 'task',
      courseId: 'target',
      status: 'queued',
      taskType: 'teacher_notebook_generation',
    });
  if (scenario === 'committing') db.state.problemImportBatch[0].status = 'committing';
  if (scenario === 'rollback') db.failSummary = true;
  if (scenario === 'taxonomy-conflict')
    db.state.courseProblemTagNode.push({
      id: 'conflict',
      courseId: 'target',
      level: 1,
      normalizedName: 'concept',
      parentId: 'other-parent',
    });
  const before = structuredClone(db.state);
  await assert.rejects(copyCourseContents(db, 'teacher', source, input), undefined, scenario);
  assert.deepEqual(db.state, before, `Rollback failed for ${scenario}`);
  checks++;
}
const sorted = groupBulkMoveCourses([
  { id: 'summer', name: 'Summer', academicYear: 2026, academicTerm: 'summer' },
  { id: 'winter', name: 'Winter', academicYear: 2026, academicTerm: 'winter' },
  { id: 'fall', name: 'Fall', academicYear: 2026, academicTerm: 'fall' },
  { id: 'next', name: 'Next', academicYear: 2027, academicTerm: 'winter' },
  { id: 'unknown', name: 'Unknown', academicYear: null, academicTerm: null },
]);
assert.deepEqual(
  sorted.map((g) => g.term),
  ['2027 Winter', '2026 Fall', '2026 Summer', '2026 Winter', '未设置学期'],
);
console.log(
  `PASS: ${checks + 1} course-copy scenarios (selection, retained originals/assets/scores, authorization, stale/replayed requests, rollback, dedupe, taxonomy, term order).`,
);

for (const selection of [{ chapterIds: ['chapter'] }, { problemIds: ['p1'] }]) {
  const original = fixture();
  const db = database(original);
  const input = { ...(await inputFor(db, false, true)), ...selection };
  await copyCourseContents(db, 'teacher', 'source', input);
  assert.equal(db.state.notebookProblem.find((row) => row.id === 'p1').courseId, 'source');
  assert.equal(db.state.notebookProblem.length, original.notebookProblem.length + 1);
  assert.equal(db.state.notebookProblem.at(-1).courseId, 'target');
  assert.deepEqual(
    db.state.notebookProblem.find((row) => row.id === 'legacy'),
    original.notebookProblem.find((row) => row.id === 'legacy'),
  );
  assert.equal(db.state.notebookProblem.find((row) => row.id === 'standalone').courseId, 'source');
  assert.deepEqual(db.state.problemImportBatch, original.problemImportBatch);
}
for (const [notebooks, problems] of [
  [true, false],
  [false, true],
  [true, true],
]) {
  const original = fixture();
  const db = database(original);
  const input = {
    ...(await inputFor(db, notebooks, problems)),
    operation: 'copy',
    notebookIds: ['book'],
    chapterIds: ['chapter'],
  };
  const result = await copyCourseContents(db, 'teacher', 'source', input);
  assert.equal(result.problems, problems ? 1 : 0);
  for (const row of original.notebookProblem)
    assert.deepEqual(
      db.state.notebookProblem.find((item) => item.id === row.id),
      row,
      'Original question unchanged',
    );
  for (const row of original.notebook)
    assert.deepEqual(
      db.state.notebook.find((item) => item.id === row.id),
      row,
      'Original notebook unchanged',
    );
  assert.deepEqual(db.state.attempts, original.attempts, 'No student attempts copied');
  assert.deepEqual(db.state.problemImportBatch, original.problemImportBatch);
  assert.deepEqual(db.state.knowledgeDocument, original.knowledgeDocument);
  if (problems) {
    const clone = db.state.notebookProblem.find(
      (row) => !original.notebookProblem.some((item) => item.id === row.id),
    );
    assert.equal(clone.courseId, 'target');
    assert.equal(
      db.state.courseProblemChapter.find((row) => row.id === clone.chapterId).name,
      'Chapter 1',
    );
    assert.equal(
      db.state.notebookProblemSecret.find((row) => row.problemId === clone.id).secretJudgeJson
        .secretTests[0],
      'hidden',
    );
    assert.equal(Boolean(clone.notebookId), notebooks);
    assert.equal(
      db.state.notebookProblemTagAssignment.filter((row) => row.problemId === clone.id).length,
      1,
    );
  }
  if (notebooks) {
    const clone = db.state.notebook.find(
      (row) => row.coverSlideJson?.copiedFromNotebookId === 'book',
    );
    assert.equal(clone.courseId, 'target');
    assert.equal(
      db.state.markdownNotebookSection.find((row) => row.notebookId === clone.id).markdown,
      '# Notes',
    );
    const page = db.state.notebookPage.find((row) => row.notebookId === clone.id);
    assert.equal(
      db.state.notebookPageContent.find((row) => row.pageId === page.id).content.text,
      'content',
    );
  }
  const after = structuredClone(db.state);
  await assert.rejects(copyCourseContents(db, 'teacher', 'source', input), /重复|已有/);
  assert.deepEqual(db.state, after, 'Retry cannot create duplicate content');
}
{
  const db = database(fixture());
  const input = {
    ...(await inputFor(db, false, true)),
    chapterIds: ['foreign-chapter'],
    operation: 'copy',
  };
  await assert.rejects(copyCourseContents(db, 'teacher', 'source', input), /不属于/);
  assert.deepEqual(db.state, fixture());
}
{
  const db = database(fixture());
  const input = { ...(await inputFor(db, true, true)), operation: 'copy' };
  db.failSummary = true;
  await assert.rejects(copyCourseContents(db, 'teacher', 'source', input), /injected failure/);
  assert.deepEqual(db.state, fixture(), 'Failed copy rolls back every new row');
}
console.log(
  'PASS: selected chapters, single question, independent notebook/problem copies, retained originals, hidden tests, student-state isolation, duplicate retry, foreign chapter and atomic copy rollback.',
);
