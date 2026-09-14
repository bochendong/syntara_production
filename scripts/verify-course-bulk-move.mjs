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
const { moveCourseContents, getCourseBulkMovePreview } = load(
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
      findMany: async ({ where } = {}) =>
        structuredClone(state[model].filter((row) => match(row, where))),
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
  const result = await moveCourseContents(db, 'teacher', 'source', input);
  assert.deepEqual(result, {
    notebooks: notebooks ? 1 : 0,
    problems: problems ? 3 : 0,
    targetCourseId: 'target',
  });
  assert.equal(
    db.state.notebook.find((r) => r.id === 'book').courseId,
    notebooks ? 'target' : 'source',
  );
  assert.equal(db.state.notebook.find((r) => r.id === 'hidden').courseId, 'source');
  assert.equal(db.state.notebook.find((r) => r.id === 'other-book').courseId, 'source');
  for (const id of ['p1', 'legacy', 'standalone']) {
    const row = db.state.notebookProblem.find((p) => p.id === id);
    assert.equal(row.courseId, problems ? 'target' : 'source');
    assert.equal(row.notebookId, notebooks && problems && id !== 'standalone' ? 'book' : null);
  }
  assert.equal(db.state.notebookProblem.find((p) => p.id === 'target-p').order, 1);
  assert.deepEqual(db.state.attempts, original.attempts);
  assert.deepEqual(db.state.scenes, original.scenes);
  assert.equal(db.state.markdownNotebookSection[0].courseId, notebooks ? 'target' : 'source');
  assert.equal(db.state.notebookPage[0].courseId, notebooks ? 'target' : 'source');
  assert.equal(db.state.notebookPage[0].imageUrl, '/image.png');
  assert.equal(db.state.problemImportBatch[0].courseId, problems ? 'target' : 'source');
  assert.equal(db.state.problemImportBatch[0].notebookId, notebooks && problems ? 'book' : null);
  assert.equal(
    db.state.notebook.find((b) => b.id === 'book').problemCount,
    notebooks && problems ? 2 : 0,
  );
  if (problems) {
    const assignment = db.state.notebookProblemTagAssignment[0];
    assert.equal(
      db.state.courseProblemTagNode.find((t) => t.id === assignment.tagId).courseId,
      'target',
    );
    const chapterId = db.state.notebookProblem.find((p) => p.id === 'p1').chapterId;
    assert.equal(db.state.courseProblemChapter.find((c) => c.id === chapterId).courseId, 'target');
    assert.ok(db.state.notebookProblem.find((p) => p.id === 'p1').problemNumber > 1);
  }
  assert.deepEqual(db.summaries, ['source', 'target']);
  const moved = structuredClone(db.state);
  await assert.rejects(moveCourseContents(db, 'teacher', 'source', input), /内容已发生变化/);
  assert.deepEqual(db.state, moved);
  checks++;
}

for (const scenario of [
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
  await assert.rejects(moveCourseContents(db, 'teacher', source, input), undefined, scenario);
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
  `PASS: ${checks + 1} bulk-move scenarios (selection, retained assets/scores, authorization, stale/replayed requests, rollback, dedupe, taxonomy, term order).`,
);
