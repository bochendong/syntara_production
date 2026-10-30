import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler } from '../staging-admin/handler.mjs';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { notebookProblemImportDraftSchema, notebookProblemGradingSchema } = jiti(
  `${root}/lib/problem-bank/schema.ts`,
);
const { readNativeProblems } = jiti(`${root}/lib/server/native-problem-sync.ts`);
const { evaluateNotebookNonCodeProblem } = jiti(`${root}/lib/server/notebook-problems/evaluate.ts`);
const { gradeLocalProblem } = jiti(`${root}/apps/native/src/data/local-problem-grading.ts`);

test('isolated staging handler, schema and native sync retain per-question opt-in', async () => {
  const date = new Date('2026-01-01T00:00:00.000Z');
  const grading = {
    type: 'calculation',
    graderKind: 'numeric_or_exact',
    referenceAnswer: '229.6875',
    acceptedForms: [],
    tolerance: 0.000001,
    numericEquivalenceVersion: 'scalar-v1',
  };
  const draft = {
    draftId: 'fixture',
    title: 'Fixture',
    type: 'calculation',
    status: 'published',
    publicContent: { type: 'calculation', stem: 'Calculate' },
    grading,
    sourceMeta: {},
  };
  const parsed = notebookProblemImportDraftSchema.parse(draft);
  assert.equal(parsed.grading.numericEquivalenceVersion, 'scalar-v1');
  const row = {
    id: 'p1',
    courseId: 'c1',
    ownerId: null,
    notebookId: null,
    chapterId: null,
    chapter: null,
    updatedAt: date,
    createdAt: date,
    contentUpdatedAt: date,
    releaseAddedIn: null,
    title: 'Fixture',
    type: 'calculation',
    status: 'published',
    difficulty: 'medium',
    tags: [],
    order: 0,
    publicContentJson: parsed.publicContent,
    gradingJson: {},
    _count: { attempts: 0 },
  };
  const db = {
    course: {
      findUnique: async () => ({
        id: 'c1',
        name: 'Fixture',
        ownerId: 'owner',
        externalBinding: null,
      }),
    },
    notebook: { findMany: async () => [] },
    notebookProblem: {
      findFirst: async () => row,
      findMany: async ({ select }) =>
        select?.id && select?.updatedAt && Object.keys(select).length === 2
          ? [{ id: row.id, updatedAt: row.updatedAt }]
          : [row],
    },
    notebookProblemProgress: { findMany: async () => [] },
    courseEnrollment: { findFirst: async () => null },
  };
  const handler = createHandler({
    db,
    Prisma: { DbNull: null },
    token: Buffer.from('fixture'),
    notebookProblemImportDraftSchema,
    notebooks: {},
    syncUnlinkedCourseKnowledgeProjection: async () => {},
    problems: {
      updateCourseProblem: async ({ patch }) => {
        row.gradingJson = notebookProblemGradingSchema.parse(patch.grading);
        return row;
      },
      createManualCourseProblem: async ({ draft: input }) => ({ grading: input.grading }),
    },
  });
  async function request(method, path, body, authorization = 'Bearer fixture') {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { url: path, method, headers: { authorization, host: '127.0.0.1:8766' } });
    const res = {
      writeHead(status) {
        this.status = status;
      },
      end(data) {
        this.data = JSON.parse(data);
      },
    };
    await handler(req, res);
    return res;
  }
  assert.equal(
    (await request('GET', '/v1/courses/c1/problems/p1', undefined, 'Bearer wrong')).status,
    403,
  );
  const created = await request('POST', '/v1/courses/c1/problems', { draft });
  assert.equal(created.status, 201);
  assert.equal(created.data.grading.numericEquivalenceVersion, 'scalar-v1');
  const patched = await request('PATCH', '/v1/courses/c1/problems/p1', {
    expectedUpdatedAt: date.toISOString(),
    patch: { grading },
  });
  assert.equal(patched.status, 200);
  assert.equal(
    (await request('GET', '/v1/courses/c1/problems/p1')).data.problem.gradingJson
      .numericEquivalenceVersion,
    'scalar-v1',
  );
  const sync = await readNativeProblems(db, 'owner', 'c1', null);
  assert.equal(sync.problems[0].grading.numericEquivalenceVersion, 'scalar-v1');
  const wireCopy = JSON.parse(JSON.stringify(sync.problems[0]));
  const web = await evaluateNotebookNonCodeProblem({
    problem: { ...wireCopy, points: 100 },
    answer: { text: '3675 / 16' },
    language: 'en-US',
  });
  const native = gradeLocalProblem(wireCopy, { kind: 'text', text: '3675 / 16' });
  assert.equal(web.status, 'passed');
  assert.equal(native.status, 'passed');
  await assert.rejects(
    request('PATCH', '/v1/courses/c1/problems/p1', {
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      patch: { grading },
    }),
    { status: 409 },
  );
  row._count.attempts = 1;
  await assert.rejects(
    request('PATCH', '/v1/courses/c1/problems/p1', {
      expectedUpdatedAt: date.toISOString(),
      patch: { grading },
    }),
    { status: 409 },
  );
});
