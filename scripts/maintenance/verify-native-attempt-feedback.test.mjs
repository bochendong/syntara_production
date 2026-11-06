import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { createJiti } from 'jiti';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const schema = await jiti.import('../../lib/problem-bank/schema.ts');
const photo = await jiti.import('../../lib/problem-bank/photo-answer.ts');
const writeSchema = schema.notebookProblemAttemptRecordSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
const source = ts.transpileModule(
  readFileSync(resolve(root, 'lib/server/native-problem-sync.ts'), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;

function fixture() {
  const writes = [];
  const mocks = {
    '@/lib/problem-bank/schema': schema,
    '@/lib/problem-bank/photo-answer': photo,
    '@/lib/server/class-session-attempts': { classSessionForAttempt: async () => null },
    '@/lib/server/repositories/course-enrollment-repository': {
      resolveCourseNotebookAccess: async () => ({ role: 'owner', notebookAccessLimit: null }),
    },
    '@/lib/server/store-course-layers': { problemLayerWhere: async () => ({}) },
    '@/lib/server/notebook-problems/service': {
      createNotebookProblemAttempt: async (args) => {
        writeSchema.parse(args); // The real persistence boundary rejects empty optional feedback.
        writes.push(args);
        return args;
      },
    },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith('@/')) throw new Error(`Unmocked dependency: ${id}`);
      return require(id);
    },
    mod,
    mod.exports,
  );
  const db = {
    notebookProblem: { findMany: async () => [{ id: 'question', points: 10 }] },
    notebookProblemAttempt: { findMany: async () => writes.map(({ id }) => ({ id })) },
  };
  return { ...mod.exports, writes, db };
}

function upload(feedback, extra = {}) {
  return {
    courseId: 'course',
    attempts: [
      {
        id: 'feedback-case-123',
        problemId: 'question',
        status: 'passed',
        score: 1,
        answer: { selectedOptionIds: ['B'] },
        feedback,
        createdAt: Date.now(),
        ...extra,
      },
    ],
  };
}

for (const feedback of [undefined, null, '', ' \n\t ']) {
  test(`answer sync accepts ${JSON.stringify(feedback)} feedback and retries without another write`, async () => {
    const f = fixture();
    const payload = f.nativeProblemAttemptUploadSchema.parse(upload(feedback));
    const first = await f.saveNativeProblemAttempts(f.db, 'learner', payload);
    assert.deepEqual(first, { saved: ['feedback-case-123'], skipped: [] });
    assert.equal(f.writes[0].result.feedback, undefined);
    assert.equal(f.writes[0].score, 10);
    assert.equal(f.writes[0].status, 'passed');
    assert.deepEqual(f.writes[0].answer, { selectedOptionIds: ['B'] });
    await f.saveNativeProblemAttempts(f.db, 'learner', payload);
    assert.equal(f.writes.length, 1);
  });
}

test('test runs and ungraded learning snapshots accept blank feedback without changing their semantics', async () => {
  for (const extra of [
    { run: 'public', answer: { code: 'print(1)' } },
    { event: 'solution_viewed' },
  ]) {
    const f = fixture();
    await f.saveNativeProblemAttempts(
      f.db,
      'learner',
      f.nativeProblemAttemptUploadSchema.parse(upload('  ', extra)),
    );
    assert.equal(f.writes[0].result.feedback, undefined);
    assert.equal(f.writes[0].preserveProgress, true);
    if (extra.event) {
      assert.equal(f.writes[0].status, 'pending');
      assert.equal(f.writes[0].score, null);
      assert.equal(f.writes[0].result.event, 'solution_viewed');
    } else assert.equal(f.writes[0].kind, 'run');
  }
});

test('multipart sync omits blank feedback, retains useful comments and preserves scores', async () => {
  const f = fixture();
  const parts = ['', '   ', '  Good work.  '].map((feedback, index) => ({
    label: String(index + 1),
    status: 'passed',
    score: 1,
    share: index === 2 ? 0.5 : 0.25,
    feedback,
  }));
  const payload = f.nativeProblemAttemptUploadSchema.parse(upload('  Passed.  ', { parts }));
  await f.saveNativeProblemAttempts(f.db, 'learner', payload);
  const result = f.writes[0].result;
  assert.equal(result.feedback, 'Passed.');
  assert.deepEqual(
    result.parts.map((part) => part.feedback),
    [undefined, undefined, 'Good work.'],
  );
  assert.deepEqual(
    result.parts.map((part) => part.score),
    [2.5, 2.5, 5],
  );
});
