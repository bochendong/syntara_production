import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import ts from 'typescript';

const jiti = createJiti(import.meta.url, { alias: { '@': resolve('.') } });
const { syncedAttemptAnswer, syncedAttemptResult } = await jiti.import(
  '../../lib/problem-bank/synced-attempt.ts',
);
function loadSync(api) {
  const source = ts.transpileModule(readFileSync('apps/native/src/data/problem-sync.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const mocks = {
    './platform-api-client': api,
    './browser-runtime': { accountStorageKey: (key) => key },
    './chat-sync': { isPlatformCourse: async () => true },
    './archive': { SYNTARA_ARCHIVE_FORMAT: 'syntara-native-archive', SYNTARA_ARCHIVE_VERSION: 1 },
  };
  new Function('require', 'module', 'exports', source)((id) => mocks[id] ?? {}, mod, mod.exports);
  return mod.exports;
}

test('choice, long text/code, blanks and table answers survive; photos/handwriting never download', () => {
  const long = '完整答案\n'.repeat(20_000);
  const answer = syncedAttemptAnswer({
    parts: {
      a: { selectedOptionIds: ['B', 'D'] },
      b: {
        text: long,
        images: [{ dataUrl: 'data:image/png;base64,PRIVATE' }],
        handwriting: { pages: ['PRIVATE'] },
      },
      c: { code: long },
      d: { blanks: { x: '42', y: '' } },
      e: { cells: { 'row:0': 'value' }, sourceCode: 'print(1)' },
    },
    privateAsset: 'PRIVATE',
  });
  assert.equal(answer.kind, 'parts');
  assert.deepEqual(answer.parts.a.selectedOptionIds, ['B', 'D']);
  assert.equal(answer.parts.b.text, long);
  assert.equal(answer.parts.b.hasImages, true);
  assert.equal(answer.parts.c.code, long);
  assert.deepEqual(answer.parts.d.blanks, { x: '42', y: '' });
  assert.equal(answer.parts.e.sourceCode, 'print(1)');
  assert.ok(!JSON.stringify(answer).includes('PRIVATE'));
});

test('image grading and multipart score ratios survive without stored assets or private fields', () => {
  const result = syncedAttemptResult(
    {
      feedback: '图片解题过程正确',
      privateAsset: 'PRIVATE',
      parts: [
        {
          label: 'a',
          status: 'partial',
          points: 40,
          score: 20,
          feedback: '继续化简',
          gradedAt: 123,
          submissions: 2,
        },
      ],
      publicCases: [{ id: 'test', passed: true, stdout: 'ok', privateAsset: 'PRIVATE' }],
    },
    100,
  );
  assert.equal(result.feedback, '图片解题过程正确');
  assert.equal(result.parts[0].score, 0.5);
  assert.equal(result.parts[0].share, 0.4);
  assert.equal(result.parts[0].submissions, 2);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('repeated downloads preserve local images, deduplicate native and server code identities, and never re-submit', async () => {
  const photo = { id: 'photo', dataUrl: 'data:image/png;base64,LOCAL' };
  const local = {
    id: 'original-id',
    problemId: 'p',
    kind: 'submit',
    answer: { kind: 'text', images: [photo] },
    result: { feedback: 'old' },
    status: 'pending',
    score: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const records = new Map([[local.id, local]]);
  const remote = {
    ...local,
    id: 'native_original-id',
    answer: { kind: 'text', hasImages: true },
    status: 'passed',
    score: 1,
    result: { feedback: 'good' },
    updatedAt: 2,
  };
  const sync = loadSync({
    getNativeProblemAttempts: async () => ({ attempts: [remote], nextCursor: 'older' }),
  });
  const repository = {
    loadProblemDocument: async () => ({ attempts: [...records.values()] }),
    importArchive: async (archive) =>
      archive.problemAttempts.forEach((item) => records.set(item.id, item)),
  };
  assert.equal(await sync.syncProblemAttempts(repository, 'c', 'p'), 'older');
  await sync.syncProblemAttempts(repository, 'c', 'p');
  assert.equal(records.size, 1);
  assert.deepEqual(records.get(local.id).answer.images, [photo]);
  assert.equal(records.get(local.id).result.feedback, 'good');
  const code = {
    ...local,
    id: 'local-code',
    result: {
      serverCodeId: 'server-code',
      serverCodeResult: { publicSummary: { passed: 3, total: 3 } },
    },
  };
  assert.equal(
    sync.mergeSyncedProblemAttempts([code], [{ ...remote, id: 'server-code' }])[0].id,
    'local-code',
  );
});

test('download merges against current disk state and a failed request preserves local history', async () => {
  let saved;
  let resolveRequest;
  const sync = loadSync({
    getNativeProblemAttempts: () =>
      new Promise((done) => {
        resolveRequest = done;
      }),
  });
  const local = {
    id: 'same',
    problemId: 'p',
    answer: { text: 'new local answer' },
    result: null,
    createdAt: 2,
  };
  const repository = {
    loadProblemDocument: async () => ({ attempts: [local] }),
    importArchive: async (archive) => {
      saved = archive.problemAttempts;
    },
  };
  const pending = sync.syncProblemAttempts(repository, 'c', 'p');
  await Promise.resolve();
  resolveRequest({
    attempts: [{ ...local, answer: { text: 'older download' } }],
    nextCursor: null,
  });
  await pending;
  assert.equal(saved[0].answer.text, 'new local answer');
  const offline = loadSync({
    getNativeProblemAttempts: async () => {
      throw Error('offline');
    },
  });
  saved = null;
  await assert.rejects(offline.syncProblemAttempts(repository, 'c', 'p'), /offline/);
  assert.equal(saved, null);
});

const databaseUrl = process.env.ATTEMPT_SYNC_TEST_DATABASE_URL;
test(
  'PostgreSQL: own visible history only, stable pagination, full text and image grades',
  { skip: !databaseUrl },
  async () => {
    assert.ok(
      ['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname),
      'Disposable local database only.',
    );
    const { PrismaClient } = await import('@prisma/client');
    const { readNativeProblemAttempts, parseAttemptCursor } = await jiti.import(
      '../../lib/server/native-problem-attempt-history.ts',
    );
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const rollback = Error('fixture rollback');
    try {
      await assert.rejects(
        db.$transaction(
          async (tx) => {
            const owner = await tx.user.create({ data: {} });
            const student = await tx.user.create({ data: {} });
            const other = await tx.user.create({ data: {} });
            const course = await tx.course.create({
              data: { name: 'Sync fixture', ownerId: owner.id, tags: [] },
            });
            await tx.courseEnrollment.create({
              data: { courseId: course.id, userId: student.id, notebookAccessLimit: 0 },
            });
            const makeProblem = (data = {}) =>
              tx.notebookProblem.create({
                data: {
                  courseId: course.id,
                  title: 'Fixture',
                  type: 'short_answer',
                  order: 0,
                  points: 100,
                  status: 'published',
                  tags: [],
                  publicContentJson: {},
                  gradingJson: {},
                  ...data,
                },
              });
            const problem = await makeProblem();
            const privateProblem = await makeProblem({ ownerId: other.id });
            const draft = await makeProblem({ status: 'draft' });
            const hiddenNotebook = await tx.notebook.create({
              data: { courseId: course.id, ownerId: owner.id, name: 'Locked' },
            });
            const locked = await makeProblem({ notebookId: hiddenNotebook.id });
            const long = 'long code\n'.repeat(10_000);
            const at = new Date('2026-01-01T00:00:00Z');
            for (let i = 0; i < 25; i++)
              await tx.notebookProblemAttempt.create({
                data: {
                  id: `sync_${String(i).padStart(3, '0')}`,
                  userId: student.id,
                  problemId: problem.id,
                  kind: 'answer',
                  status: 'partial',
                  score: 50,
                  createdAt: at,
                  answerJson: {
                    selectedOptionIds: ['B'],
                    text: long,
                    images: [{ dataUrl: 'data:image/png;base64,PRIVATE' }],
                  },
                  resultJson: { feedback: '图片得分反馈' },
                },
              });
            await tx.notebookProblemAttempt.create({
              data: {
                userId: other.id,
                problemId: problem.id,
                kind: 'answer',
                status: 'passed',
                answerJson: { text: 'OTHER USER PRIVATE' },
              },
            });
            await tx.notebookProblemAttempt.create({
              data: {
                userId: student.id,
                problemId: problem.id,
                kind: 'run',
                answerJson: { code: 'run only' },
              },
            });
            assert.equal(
              await readNativeProblemAttempts(tx, other.id, course.id, problem.id, null),
              null,
            );
            for (const id of [privateProblem.id, draft.id, locked.id, 'missing'])
              assert.equal(
                await readNativeProblemAttempts(tx, student.id, course.id, id, null),
                null,
              );
            const first = await readNativeProblemAttempts(
              tx,
              student.id,
              course.id,
              problem.id,
              null,
            );
            assert.equal(first.attempts.length, 20);
            assert.equal(first.attempts[0].score, 0.5);
            assert.equal(first.attempts[0].answer.text, long);
            assert.deepEqual(first.attempts[0].answer.selectedOptionIds, ['B']);
            assert.equal(first.attempts[0].answer.hasImages, true);
            assert.equal(first.attempts[0].result.feedback, '图片得分反馈');
            assert.ok(!JSON.stringify(first).includes('PRIVATE'));
            const second = await readNativeProblemAttempts(
              tx,
              student.id,
              course.id,
              problem.id,
              parseAttemptCursor(first.nextCursor),
            );
            assert.equal(second.attempts.length, 5);
            assert.equal(second.nextCursor, null);
            assert.equal(
              new Set([...first.attempts, ...second.attempts].map((item) => item.id)).size,
              25,
            );
            await tx.notebookProblemAttempt.update({
              where: { id: first.attempts[0].id },
              data: { score: 100, status: 'passed' },
            });
            assert.equal(
              (await readNativeProblemAttempts(tx, student.id, course.id, problem.id, null))
                .attempts[0].score,
              1,
            );
            assert.throws(() => parseAttemptCursor('{bad'));
            throw rollback;
          },
          { timeout: 30_000 },
        ),
        (error) => error === rollback,
      );
    } finally {
      await db.$disconnect();
    }
  },
);
