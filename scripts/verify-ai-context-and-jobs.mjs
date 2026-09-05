import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const { prepareCourseTurnContext, CourseContextError, localDateBoundary } = await jiti.import(
  '../features/chat/server/turn-context.ts',
);
const { hasValidNoteEvidence } = await jiti.import('../features/background-jobs/server/memory.ts');
const { prepareCourseConversationContext } = await jiti.import(
  '../features/chat/server/course-context-compression.ts',
);
const { chatContextSelectionSchema } = await jiti.import(
  '../features/chat/domain/context-selection.ts',
);
const store = await jiti.import('../features/background-jobs/server/store.ts');
const { PrismaClient } = await jiti.import('../lib/server/generated-prisma.ts');

const access = { userId: 'teacher', role: 'owner', course: { id: 'course-a', ownerId: 'teacher' } };
let readWhere;
const db = {
  courseEnrollment: {
    findUnique: async () => ({ userId: 'student-a', user: { isActive: true, name: '小林' } }),
  },
  notebookProblem: {
    findFirst: async ({ where }) => {
      assert.equal(where.id, 'problem-a');
      return { id: 'problem-a' };
    },
  },
  notebookProblemAttempt: {
    findFirst: async ({ where }) => {
      readWhere = where;
      if (where.id !== 'attempt-a' || where.userId !== 'student-a') return null;
      return {
        id: 'attempt-a',
        problemId: 'problem-a',
        answerJson: { code: 'return a + b' },
        resultJson: { feedback: '边界条件不成立' },
        score: 0,
        status: 'failed',
        createdAt: new Date(),
        problem: { title: '边界条件', notebookId: null, publicContentJson: { stem: '计算边界' } },
      };
    },
  },
};
const context = await prepareCourseTurnContext({
  db,
  access,
  selection: { source: 'problem-attempt', studentId: 'student-a', attemptId: 'attempt-a' },
});
assert.equal(readWhere.userId, 'student-a');
assert.equal(readWhere.problem.OR[0].courseId, 'course-a');
assert.deepEqual(context.evidence.find((e) => e.kind === 'attempt').content.answer, {
  code: 'return a + b',
});
assert.equal(
  context.evidence.find((e) => e.kind === 'attempt').content.result.feedback,
  '边界条件不成立',
);
await assert.rejects(
  () =>
    prepareCourseTurnContext({
      db,
      access,
      selection: { source: 'problem-attempt', studentId: 'student-b', attemptId: 'other' },
    }),
  CourseContextError,
);
await assert.rejects(
  () =>
    prepareCourseTurnContext({
      db,
      access: { ...access, role: 'enrolled', userId: 'student-a' },
      selection: { source: 'teacher-student', studentId: 'student-b' },
    }),
  (error) => error.status === 403,
);
await assert.rejects(
  () =>
    prepareCourseTurnContext({
      db,
      access,
      selection: { source: 'calendar', studentId: 'student-a' },
    }),
  (error) => error.status === 403,
);
assert.equal(chatContextSelectionSchema.safeParse({ source: 'problem-attempt' }).success, false);
assert.equal(
  chatContextSelectionSchema.safeParse({
    source: 'calendar',
    startDate: '2026-02-30',
    endDate: '2026-03-01',
  }).success,
  false,
);
assert.equal(
  localDateBoundary('2026-09-05', 'Asia/Shanghai').toISOString(),
  '2026-09-04T16:00:00.000Z',
);
assert.equal(
  localDateBoundary('2026-03-09', 'America/New_York').getTime() -
    localDateBoundary('2026-03-08', 'America/New_York').getTime(),
  23 * 3600000,
);
assert.equal(
  hasValidNoteEvidence({ evidence: [{ sourceId: 'm1', excerpt: '我常忘记边界' }] }, [
    { id: 'm1', role: 'user', text: '我常忘记边界' },
  ]),
  true,
);
assert.equal(
  hasValidNoteEvidence({ evidence: [{ sourceId: 'm1', excerpt: '已经掌握' }] }, [
    { id: 'm1', role: 'assistant', text: '已经掌握' },
  ]),
  false,
);
assert.equal(
  hasValidNoteEvidence({ evidence: [{ sourceId: 'm1', excerpt: '猜测' }] }, [
    { id: 'm1', role: 'user', text: '不会这道题' },
  ]),
  false,
);
let modelCalls = 0;
const prepared = await prepareCourseConversationContext({
  messages: Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? 'assistant' : 'user',
    parts: [{ type: 'text', text: `内容${i}` }],
  })),
  mode: 'student',
  model: {
    doGenerate() {
      modelCalls++;
      throw new Error('No foreground summary');
    },
  },
});
assert.equal(modelCalls, 0);
assert.equal(prepared.compression.retainedMessageCount, 8);
assert.ok(prepared.modelMessages.length <= 9);
assert.equal(store.inputHash({ a: 1, b: { c: 2 } }), store.inputHash({ b: { c: 2 }, a: 1 }));
for (const path of [
  'app/api/notebooks/send-message/route.ts',
  'components/chat/use-notebook-chat-actions.ts',
]) {
  const source = await readFile(path, 'utf8');
  assert.doesNotMatch(
    source,
    /await writeDurableMemoryForPlan|reconcilePendingNotebookChatDurableMemories|queueChatTurnWorkingMemoryUpdate|memoryDiagnosisShape/,
  );
}
console.log(
  'PASS context scope, exact answer and feedback, calendar privacy/DST, note evidence, no foreground summarization',
);

const { MockLanguageModelV3 } = await import('ai/test');
const { processMemoryJob } = await jiti.import('../features/background-jobs/server/memory.ts');
let summaryCalls = 0;
const summaryModel = new MockLanguageModelV3({
  doGenerate: async () => {
    summaryCalls++;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: '正在学习边界条件',
            notes: [
              {
                existingId: null,
                title: '边界条件',
                text: '学生表示经常遗漏边界；下一步核对空输入。',
                kind: 'learning_state',
                evidence: [{ sourceId: 'source1', excerpt: '我常忘记边界' }],
              },
            ],
          }),
        },
      ],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 10, text: 10 } },
      warnings: [],
    };
  },
});
const changedSourceDb = {
  user: { findFirst: async () => ({ id: 'u1' }) },
  course: { findFirst: async () => ({ id: 'c1', name: '测试课程' }) },
  courseConversation: {
    findFirst: async () => ({
      id: 'conversation1',
      summaryText: null,
      revision: BigInt(3),
      summaryVersion: 1,
      messageCount: 1,
    }),
  },
  courseConversationMessage: {
    findMany: async () => [
      {
        id: 'source1',
        plainText: '我常忘记边界',
        role: 'user',
        sequence: BigInt(1),
        createdAt: new Date(),
      },
    ],
  },
  studyMemory: { findMany: async () => [] },
  $transaction: async (run) =>
    run({
      backgroundJob: { updateMany: async () => ({ count: 1 }) },
      courseConversation: {
        updateMany: async ({ where }) => {
          assert.equal(where.revision, BigInt(3));
          assert.equal(where.summaryVersion, 1);
          return { count: 0 };
        },
      },
      studyMemory: {
        createMany: async () => {
          throw new Error('Stale source must never write notes');
        },
      },
    }),
};
const memoryJob = {
  id: 'memory1',
  ownerId: 'u1',
  courseId: 'c1',
  kind: 'conversation-memory',
  payload: { conversationId: 'conversation1' },
  createdAt: new Date(),
  leaseToken: 'lease',
};
const stale = await processMemoryJob(changedSourceDb, memoryJob, { model: summaryModel });
assert.equal(stale.skipped, 'source-changed');
const deleted = await processMemoryJob(
  { ...changedSourceDb, courseConversation: { findFirst: async () => null } },
  memoryJob,
  { model: summaryModel },
);
assert.equal(deleted.skipped, 'deleted');
assert.equal(summaryCalls, 1, 'Deleted sources never call a model');
console.log('PASS background summary refuses changed/deleted source revisions before note writes');

await jiti.import('./verify-teacher-course-agent.ts');

const url = process.env.AI_JOBS_TEST_DATABASE_URL;
if (!url) {
  console.log(
    'SKIP PostgreSQL integration (set AI_JOBS_TEST_DATABASE_URL to a disposable local database)',
  );
  process.exit(0);
}
const parsed = new URL(url);
assert.ok(
  ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
    parsed.pathname === '/syntara_ai_jobs_test',
  'Only the disposable local database is allowed',
);
const pg = new PrismaClient({ datasourceUrl: url });
try {
  await pg.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "User" ("id" TEXT PRIMARY KEY)');
  await pg.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "Course" ("id" TEXT PRIMARY KEY)');
  const migration = await readFile(
    'prisma/migrations/20260905120000_durable_ai_jobs/migration.sql',
    'utf8',
  );
  const exists = await pg.$queryRaw`SELECT to_regclass('"BackgroundJob"')::text AS name`;
  if (!exists[0].name)
    for (const sql of migration
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await pg.$executeRawUnsafe(sql);
  await pg.$executeRawUnsafe('TRUNCATE "BackgroundJob", "User", "Course" CASCADE');
  await pg.$executeRawUnsafe('INSERT INTO "User" ("id") VALUES (\'u1\'), (\'u2\')');
  await pg.$executeRawUnsafe('INSERT INTO "Course" ("id") VALUES (\'c1\')');
  const args = {
    ownerId: 'u1',
    courseId: 'c1',
    kind: 'mini-lecture',
    key: 'lecture:message1',
    payload: { answer: 'original answer', pageCount: 1 },
  };
  const repeated = await Promise.all(Array.from({ length: 8 }, () => store.enqueueJob(pg, args)));
  assert.equal(
    new Set(repeated.map((j) => j.id)).size,
    1,
    'Concurrent confirmations reuse one task',
  );
  await assert.rejects(
    () => store.enqueueJob(pg, { ...args, payload: { answer: 'different answer' } }),
    store.JobConflictError,
  );
  const claims = await Promise.all([store.claimJob(pg), store.claimJob(pg)]);
  assert.equal(claims.filter(Boolean).length, 1, 'Only one worker may own a lease');
  const first = claims.find(Boolean);
  assert.equal(await pg.backgroundJob.findFirst({ where: { id: first.id, ownerId: 'u2' } }), null);
  let calls = 0;
  const stage = () => {
    calls++;
    return Promise.resolve({ image: 'durable-output' });
  };
  await store.checkpoint(pg, first, 'page1', stage);
  await pg.backgroundJob.update({
    where: { id: first.id },
    data: { leaseUntil: new Date(Date.now() - 1000) },
  });
  const reclaimed = await store.claimJob(pg);
  assert.notEqual(reclaimed.leaseToken, first.leaseToken);
  assert.equal(await store.renewLease(pg, first), false);
  assert.equal(
    await store.finishJob(pg, first, { wrong: true }),
    false,
    'Expired worker cannot finish',
  );
  await store.checkpoint(pg, reclaimed, 'page1', stage);
  assert.equal(calls, 1, 'Completed expensive stage survives restart');
  assert.equal(await store.finishJob(pg, reclaimed, { lectureId: 'lecture1' }), true);
  const completed = await pg.backgroundJob.findUnique({ where: { id: first.id } });
  assert.deepEqual(store.unpackResult(completed.result), { lectureId: 'lecture1' });
  assert.equal(await store.claimJob(pg), null);
  await assert.rejects(() =>
    pg.$transaction(async (tx) => {
      await store.enqueueJob(tx, { ...args, key: 'rolled-back' });
      throw new Error('rollback');
    }),
  );
  assert.equal(
    await pg.backgroundJob.count({ where: { dedupeKey: 'rolled-back' } }),
    0,
    'Source and event share one transaction',
  );
  const retryJob = await store.enqueueJob(pg, { ...args, key: 'retry' });
  const running = await store.claimJob(pg);
  await store.failJob(pg, running, new Error('test failure'));
  const failed = await pg.backgroundJob.findUnique({ where: { id: retryJob.id } });
  assert.equal(failed.status, 'queued');
  assert.ok(failed.availableAt > new Date());
  console.log(
    'PASS PostgreSQL concurrent confirmation, ownership, lease recovery/fencing, checkpoint reuse, result persistence, transactional intake and retry',
  );
} finally {
  await pg.$disconnect();
}
