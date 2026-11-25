import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';

const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const { resetBankPractice } = jiti('../../lib/server/native-bank-reset.ts');
const { readNativeProblemAttempts } = jiti('../../lib/server/native-problem-attempt-history.ts');
const url = process.env.ATTEMPT_SYNC_TEST_DATABASE_URL;
test(
  'reset is atomic, scoped to the learner and visible question IDs, and supports a fresh round',
  { skip: !url },
  async () => {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
    const db = new PrismaClient({ datasources: { db: { url } } });
    const rollback = new Error('rollback fixture');
    try {
      await assert.rejects(
        db.$transaction(
          async (tx) => {
            const me = await tx.user.create({ data: {} });
            const other = await tx.user.create({ data: {} });
            const course = await tx.course.create({
              data: { name: 'Reset fixture', ownerId: me.id, tags: [] },
            });
            const create = () =>
              tx.notebookProblem.create({
                data: {
                  courseId: course.id,
                  title: 'P',
                  type: 'short_answer',
                  order: 0,
                  points: 10,
                  status: 'published',
                  publicContentJson: {},
                  gradingJson: {},
                  tags: [],
                },
              });
            const [first, second, outside] = await Promise.all([create(), create(), create()]);
            const cutoff = Date.now() - 5000;
            const submit = async (problemId, userId, at) => {
              const attempt = await tx.notebookProblemAttempt.create({
                data: {
                  problemId,
                  userId,
                  kind: 'answer',
                  status: 'passed',
                  answerJson: { text: 'A' },
                  createdAt: new Date(at),
                },
              });
              await tx.notebookProblemProgress.upsert({
                where: { problemId_userId: { problemId, userId } },
                create: {
                  problemId,
                  userId,
                  status: 'passed',
                  attemptedCount: 1,
                  passedCount: 1,
                  latestAttemptId: attempt.id,
                  lastAttemptAt: new Date(at),
                },
                update: {
                  status: 'passed',
                  attemptedCount: { increment: 1 },
                  passedCount: { increment: 1 },
                  latestAttemptId: attempt.id,
                  lastAttemptAt: new Date(at),
                },
              });
            };
            await submit(first.id, me.id, cutoff - 1);
            await submit(outside.id, me.id, cutoff - 1);
            await submit(first.id, other.id, cutoff - 1);
            const fixture = new Proxy(tx, {
              get(target, key) {
                return key === '$transaction' ? (fn) => fn(tx) : target[key];
              },
            });
            const reset = (ids) =>
              resetBankPractice(fixture, me.id, {
                action: 'resetPractice',
                courseId: course.id,
                problemIds: ids,
                through: cutoff,
              });
            const count = async (problemId, userId) =>
              (
                await tx.notebookProblemProgress.findUniqueOrThrow({
                  where: { problemId_userId: { problemId, userId } },
                })
              ).attemptedCount;
            assert.equal(await reset([first.id, 'not-visible']), null);
            assert.equal(await count(first.id, me.id), 1);
            assert.deepEqual(await reset([first.id, first.id, second.id]), { resetAt: cutoff });
            assert.deepEqual(await reset([first.id, second.id]), { resetAt: cutoff });
            assert.equal(await count(first.id, me.id), 0);
            assert.equal(await count(second.id, me.id), 0);
            assert.equal(await count(first.id, other.id), 1);
            assert.equal(await count(outside.id, me.id), 1);
            const history = () => readNativeProblemAttempts(tx, me.id, course.id, first.id, null);
            assert.equal((await history()).attempts.length, 0);
            await submit(first.id, me.id, cutoff + 1);
            assert.equal((await history()).attempts.length, 1);
            assert.deepEqual(await reset([first.id]), { resetAt: cutoff });
            await submit(outside.id, me.id, cutoff + 1);
            assert.deepEqual(await reset([outside.id]), { conflict: true });
            assert.equal(await count(first.id, me.id), 1);
            throw rollback;
          },
          { timeout: 15000 },
        ),
        (error) => {
          if (error !== rollback) throw error;
          return true;
        },
      );
    } finally {
      await db.$disconnect();
    }
  },
);
